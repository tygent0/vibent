import fs from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createId } from "../lib/ids.js";
import { getChangedFiles, getCurrentDiff, getHeadSha, getRepoRoot } from "../lib/git.js";
import { sha256 } from "../lib/hash.js";
import { publishToApi } from "../lib/http.js";
import {
  buildResumePlan,
  buildSnapshot,
  generateVerifyHighlights,
  querySessionMemory
} from "../lib/memory.js";
import { runAutomatedReview } from "../lib/review.js";
import { redactSecrets } from "../lib/redact.js";
import { runCommand } from "../lib/shell.js";
import { filesFromDiff, isWithinScope } from "../lib/scope.js";
import { LocalStore, RunRecord, SessionRecord } from "../lib/store.js";
import { planCommands } from "../lib/testPlanner.js";

function resolveSession(store: LocalStore, goalHint = "Session"): SessionRecord {
  return store.getActiveSession() ?? store.ensureActiveSession(goalHint);
}

export async function agentServeCommandHandler(): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/v1/status", async () => ({
    capabilities: ["run", "patch", "eval", "review", "bundle", "publish", "release", "session", "memory", "resume", "signals"],
    repoConnected: store.isGithubConnected(),
    authState: store.isGithubConnected() ? "connected" : "disconnected"
  }));

  app.post("/v1/run/create", async (request, reply) => {
    const body = request.body as { goal: string; scopeHints?: string[]; baseRef?: string };
    if (!body.goal) {
      reply.code(400);
      return { error: "goal is required" };
    }

    const runId = createId("run");
    const baseSha = await getHeadSha(repoRoot);
    const diff = await getCurrentDiff(repoRoot);
    const session = resolveSession(store, body.goal);
    const now = new Date().toISOString();

    const run: RunRecord = {
      id: runId,
      goal: body.goal,
      baseRef: body.baseRef ?? "HEAD",
      baseSha,
      patchPointer: "",
      evalPointers: [],
      transcriptPointer: null,
      reproducibility: "replayable-locally",
      status: "Draft",
      changedFiles: await getChangedFiles(repoRoot),
      scopeHints: body.scopeHints,
      sessionId: session.id,
      createdAt: now,
      updatedAt: now
    };

    store.saveRun(run, diff);
    store.linkRunToSession(run.id, session.id);
    store.createEvent({
      sessionId: session.id,
      runId: run.id,
      type: "prompt",
      payload: { text: body.goal }
    });
    store.createHighlight({
      sessionId: session.id,
      runId: run.id,
      type: "goal",
      text: `Goal: ${body.goal}`,
      pointers: { runId: run.id, files: run.changedFiles }
    });
    buildSnapshot(store, session, "Run created", process.env);
    buildResumePlan(store, session);

    reply.code(201);
    return { run_id: run.id, session_id: session.id };
  });

  app.post("/v1/patch/propose", async (request, reply) => {
    const body = request.body as { run_id: string; diff: string };
    const run = store.getRun(body.run_id);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const touchedFiles = filesFromDiff(body.diff);
    if (!isWithinScope(touchedFiles, run.scopeHints)) {
      reply.code(400);
      return { error: "This patch edits files outside the requested scope." };
    }

    store.saveRun({ ...run, changedFiles: touchedFiles, updatedAt: new Date().toISOString() }, body.diff);
    if (run.sessionId) {
      store.createEvent({
        sessionId: run.sessionId,
        runId: run.id,
        type: "file_write",
        payload: {
          path: run.patchPointer,
          hash: sha256(body.diff),
          files: touchedFiles
        }
      });
    }
    return { patch_id: createId("patch"), files: touchedFiles };
  });

  app.post("/v1/eval/plan", async (request, reply) => {
    const body = request.body as { run_id: string; patch_id?: string; maxSeconds?: number };
    const run = store.getRun(body.run_id);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const maxSeconds = Math.min(body.maxSeconds ?? 300, 900);
    const commands = planCommands(repoRoot, run.changedFiles);
    if (commands.length > 5) {
      reply.code(400);
      return { error: "Requested plan exceeds local budget." };
    }

    const plan = {
      id: createId("plan"),
      runId: run.id,
      commands,
      maxSeconds,
      createdAt: new Date().toISOString()
    };

    store.savePlan(plan);
    return { plan_id: plan.id, commands };
  });

  app.post("/v1/eval/run", async (request, reply) => {
    const body = request.body as { plan_id: string };
    const plan = store.getPlan(body.plan_id);
    if (!plan) {
      reply.code(404);
      return { error: "Plan not found" };
    }

    const run = store.getRun(plan.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const logs: string[] = [];
    let passed = true;

    for (const cmd of plan.commands) {
      const startedAt = Date.now();
      const result = await runCommand(cmd, repoRoot, plan.maxSeconds * 1000);
      logs.push(`$ ${cmd}\n${result.stdout}${result.stderr}`);
      if (run.sessionId) {
        store.createEvent({
          sessionId: run.sessionId,
          runId: run.id,
          type: "command",
          payload: {
            cmd,
            exit_code: result.code,
            stdout_hash: sha256(result.stdout),
            stderr_hash: sha256(result.stderr)
          }
        });
        store.createEvent({
          sessionId: run.sessionId,
          runId: run.id,
          type: "test_run",
          payload: {
            suite: cmd,
            result: result.code === 0 ? "passed" : "failed",
            duration_ms: Date.now() - startedAt
          }
        });
      }
      if (result.code !== 0) {
        passed = false;
        break;
      }
    }

    const evalId = createId("eval");
    const artifact = store.artifactPath(`${evalId}.log`);
    const redactedLogs = redactSecrets(logs.join("\n\n"));
    fs.writeFileSync(artifact, redactedLogs);

    const evalResult = {
      id: evalId,
      runId: plan.runId,
      commands: plan.commands,
      passed,
      summary: passed ? "All checks passed" : "At least one check failed",
      artifactPointer: artifact,
      createdAt: new Date().toISOString()
    };
    store.saveEval(evalResult);

    if (run.sessionId) {
      const session = store.getSession(run.sessionId);
      if (session) {
        for (const draft of generateVerifyHighlights({ run, evalResult, redactedLogs })) {
          store.createHighlight({
            sessionId: session.id,
            runId: run.id,
            type: draft.type,
            text: draft.text,
            pointers: draft.pointers,
            confidence: draft.confidence
          });
        }
        buildSnapshot(store, session, evalResult.summary, process.env);
        buildResumePlan(store, session);
      }
    }

    return { eval_id: evalId, passed };
  });

  app.post("/v1/review/run", async (request, reply) => {
    const body = request.body as { run_id: string; commands?: string[] };
    const run = store.getRun(body.run_id);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const review = await runAutomatedReview({
      store,
      run,
      repoRoot,
      commands: body.commands
    });

    if (run.sessionId) {
      const session = store.getSession(run.sessionId);
      if (session) {
        store.createHighlight({
          sessionId: session.id,
          runId: run.id,
          type: review.passed ? "fix" : "failure",
          text: review.passed ? `Review passed for ${run.id}.` : `Review blocked for ${run.id}.`,
          pointers: { runId: run.id, files: run.changedFiles }
        });
        buildSnapshot(store, session, review.summary, process.env);
        buildResumePlan(store, session);
      }
    }

    return { review };
  });

  app.post("/v1/release/create", async (request, reply) => {
    const body = request.body as { run_id: string; environment?: string; traffic_percent?: number; notes?: string };
    const run = store.getRun(body.run_id);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = store.latestReview(run.id);
    if (!review || !review.passed) {
      reply.code(400);
      return { error: "Release requires passing review." };
    }
    const trafficPercent = Math.min(100, Math.max(0, Math.round(body.traffic_percent ?? 10)));
    const release = store.createRelease({
      runId: run.id,
      bundleId: null,
      environment: body.environment ?? "dev",
      status: trafficPercent >= 100 ? "stable" : "canary",
      trafficPercent,
      version: `${new Date().toISOString().slice(0, 10)}-${run.id.slice(-6)}`,
      notes: body.notes ?? ""
    });
    return { release };
  });

  app.post("/v1/release/promote", async (request, reply) => {
    const body = request.body as { release_id: string; traffic_percent?: number };
    const release = store.getRelease(body.release_id);
    if (!release) {
      reply.code(404);
      return { error: "Release not found" };
    }
    release.trafficPercent = Math.min(100, Math.max(0, Math.round(body.traffic_percent ?? 100)));
    release.status = release.trafficPercent >= 100 ? "stable" : "canary";
    store.updateRelease(release);
    return { release };
  });

  app.post("/v1/release/rollback", async (request, reply) => {
    const body = request.body as { release_id: string; reason?: string };
    const release = store.getRelease(body.release_id);
    if (!release) {
      reply.code(404);
      return { error: "Release not found" };
    }
    release.status = "rolled_back";
    release.trafficPercent = 0;
    release.notes = release.notes
      ? `${release.notes}\nRollback: ${body.reason ?? "manual rollback"}`
      : `Rollback: ${body.reason ?? "manual rollback"}`;
    store.updateRelease(release);
    return { release };
  });

  app.get("/v1/release/list", async (request) => {
    const query = request.query as { run_id?: string };
    return { releases: store.listReleases(query.run_id) };
  });

  app.post("/v1/signals/ingest", async (request, reply) => {
    const body = request.body as {
      session_id?: string;
      run_id?: string;
      source?: string;
      type?: "error_rate" | "latency" | "availability" | "rollback" | "cost" | "throughput";
      severity?: "info" | "warning" | "critical";
      summary?: string;
      metric_value?: number;
      unit?: string;
    };
    if (!body.type || !body.summary?.trim()) {
      reply.code(400);
      return { error: "type and summary are required" };
    }
    const run = body.run_id ? store.getRun(body.run_id) : null;
    const session =
      (body.session_id ? store.getSession(body.session_id) : null) ??
      (run?.sessionId ? store.getSession(run.sessionId) : null) ??
      store.getActiveSession();
    const signal = store.createSignal({
      sessionId: session?.id ?? null,
      runId: run?.id ?? null,
      source: body.source ?? "manual",
      type: body.type,
      severity: body.severity ?? "warning",
      summary: body.summary.trim(),
      metricValue: body.metric_value ?? null,
      unit: body.unit ?? null
    });
    if (session) {
      store.createHighlight({
        sessionId: session.id,
        runId: run?.id ?? null,
        type: signal.severity === "critical" ? "regression" : "finding",
        text: `Signal ${signal.type}: ${signal.summary}`,
        pointers: { runId: run?.id, files: run?.changedFiles ?? [] }
      });
      buildSnapshot(store, session, `Signal ${signal.type} ${signal.severity}`, process.env);
      buildResumePlan(store, session);
    }
    reply.code(201);
    return { signal };
  });

  app.post("/v1/bundle/summarize", async (request, reply) => {
    const body = request.body as { run_id: string };
    const run = store.getRun(body.run_id);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    const evals = store.getEvals(run.id);
    const summary = [
      `Goal: ${run.goal}`,
      `Diff: ${run.patchPointer}`,
      `Tests: ${evals.map((e) => e.commands.join(", ")).join(" | ") || "none"}`,
      `Results: ${evals.every((e) => e.passed) ? "pass" : "fail"}`,
      `Reproduce: vibent replay ${run.id}`
    ].join("\n");

    return { run_id: run.id, summary };
  });

  app.post("/v1/publish", async (request, reply) => {
    const body = request.body as { run_id: string; mode?: "pr" | "direct"; pr_url?: string; pr_number?: number };
    const mode = body.mode ?? "pr";
    if (mode === "pr" && !store.isGithubConnected()) {
      reply.code(400);
      return { error: "Publishing requires GitHub connection." };
    }
    const review = store.latestReview(body.run_id);
    if (!review || !review.passed) {
      reply.code(400);
      return { error: "Publishing requires a passing review." };
    }
    const response = await publishToApi({
      runId: body.run_id,
      mode,
      prUrl: body.pr_url,
      prNumber: body.pr_number
    });

    return response;
  });

  app.post("/v1/session/start", async (request) => {
    const body = request.body as { title?: string; from?: string; branchRef?: string; createdBy?: string };
    const title = body.title?.trim() || "Session";
    const session = store.createSession({
      title,
      createdBy: body.createdBy,
      branchRef: body.branchRef ?? body.from ?? null
    });
    if (body.from) {
      const run = store.getRun(body.from);
      if (run) {
        store.linkRunToSession(run.id, session.id);
      }
    }
    const snapshot = buildSnapshot(store, session, "Session started", process.env);
    const resume = buildResumePlan(store, session);
    return { session, snapshot, resume };
  });

  app.post("/v1/session/continue", async (request, reply) => {
    const body = request.body as { session_id?: string; sessionId?: string };
    const targetId = body.session_id ?? body.sessionId ?? store.getActiveSessionId();
    if (!targetId) {
      reply.code(404);
      return { error: "No session to continue" };
    }
    const session = store.continueSession(targetId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found or archived" };
    }
    const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session);
    return { session, resume };
  });

  app.get("/v1/session/status", async (_request, reply) => {
    const session = store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "No active session" };
    }
    const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session);
    const highlights = store.listHighlights(session.id, 10);
    return { session, highlights, resume };
  });

  app.post("/v1/session/note", async (request, reply) => {
    const body = request.body as { session_id?: string; text?: string };
    if (!body.text?.trim()) {
      reply.code(400);
      return { error: "text is required" };
    }
    const session = body.session_id ? store.getSession(body.session_id) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const note = store.addNote(session.id, body.text.trim());
    const snapshot = buildSnapshot(store, session, "Note added", process.env);
    return { note, snapshot };
  });

  app.post("/v1/session/pin", async (request, reply) => {
    const body = request.body as { session_id?: string; pinned?: boolean };
    if (!body.session_id) {
      reply.code(400);
      return { error: "session_id is required" };
    }
    const session = store.pinSession(body.session_id, body.pinned ?? true);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    return { session };
  });

  app.post("/v1/memory/query", async (request, reply) => {
    const body = request.body as {
      session_id?: string;
      query?: string;
      files?: string[];
      symbols?: string[];
      limit?: number;
    };
    const session = body.session_id ? store.getSession(body.session_id) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const memory = querySessionMemory(store, session, {
      query: body.query,
      files: body.files ?? [],
      symbols: body.symbols ?? [],
      limit: body.limit ?? 5
    });
    return memory;
  });

  app.get("/v1/memory/snapshot", async (request, reply) => {
    const query = request.query as { session_id?: string };
    const session = query.session_id ? store.getSession(query.session_id) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const snapshot = store.latestSnapshot(session.id);
    if (!snapshot) {
      reply.code(404);
      return { error: "Snapshot not found" };
    }
    return { snapshot };
  });

  app.post("/v1/resume/plan", async (request, reply) => {
    const body = request.body as { session_id?: string };
    const session = body.session_id ? store.getSession(body.session_id) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const resume = buildResumePlan(store, session);
    return { resume };
  });

  const port = Number(process.env.VIBENT_AGENT_PORT ?? 7777);
  const host = process.env.VIBENT_AGENT_HOST ?? "127.0.0.1";
  await app.listen({ port, host });
  console.log(`vibent agent daemon listening at http://${host}:${port}`);
}
