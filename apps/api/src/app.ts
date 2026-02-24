import fs from "node:fs";
import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  createRunRequestSchema,
  EvalResult,
  evalResultSchema,
  highlightSchema,
  memoryQueryRequestSchema,
  memorySnapshotSchema,
  productionSignalSchema,
  publishRequestSchema,
  releaseCreateRequestSchema,
  releasePromoteRequestSchema,
  releaseRollbackRequestSchema,
  releaseSchema,
  reviewFindingSchema,
  reviewRunRequestSchema,
  reviewResultSchema,
  resumePlanRequestSchema,
  resumePlanSchema,
  runSchema,
  signalIngestRequestSchema,
  sessionContinueRequestSchema,
  sessionEventSchema,
  sessionNoteRequestSchema,
  sessionSchema,
  sessionStartRequestSchema,
  statusSchema
} from "@vibent/shared";
import { loadConfig } from "./config.js";
import { createId } from "./lib/ids.js";
import { publishEvidence } from "./lib/github.js";
import { createMockGithubClient } from "./lib/mockGithub.js";
import { hashRunManifest } from "./lib/runManifest.js";
import { FileStore } from "./lib/store.js";
import { suggestCommands } from "./lib/testPlanner.js";
import { validateGithubSignature } from "./lib/webhook.js";

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .filter((token) => token.length >= 2);
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const lookup = new Set(left);
  let hits = 0;
  for (const token of right) {
    if (lookup.has(token)) hits += 1;
  }
  return hits / Math.max(1, Math.min(left.length, right.length));
}

function recencyScore(isoTs: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(isoTs).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays);
}

function extractTopErrorLine(summary: string): string {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => /(error|failed|exception|ERR_)/i.test(line));
  return (errorLine ?? lines[0] ?? "verification failed").slice(0, 200);
}

function changedSinceLastKnownGood(store: FileStore, sessionId: string): string[] {
  const snapshot = store.latestSnapshot(sessionId);
  if (!snapshot?.lastKnownGood) return [];
  const runs = store.listRunsForSession(sessionId);
  const files = new Set<string>();
  for (const run of runs) {
    if (run.id === snapshot.lastKnownGood) break;
    const runWithSession = run as typeof run & { changedFiles?: string[] };
    for (const file of runWithSession.changedFiles ?? []) {
      files.add(file);
    }
  }
  return [...files].slice(0, 12);
}

function ensureActiveSession(store: FileStore, goal: string): ReturnType<typeof sessionSchema.parse> {
  const active = store.getActiveSession();
  if (active && active.status === "active") {
    return active;
  }

  const now = new Date().toISOString();
  const session = sessionSchema.parse({
    id: createId("sess"),
    repoId: "local-repo",
    startedAt: now,
    lastActiveAt: now,
    createdBy: "local-user",
    branchRef: null,
    title: goal,
    status: "active",
    pinned: false,
    summary: "",
    linkedRuns: []
  });
  store.upsertSession(session);
  store.setActiveSession(session.id);
  return session;
}

function buildResumePlan(store: FileStore, sessionId: string): ReturnType<typeof resumePlanSchema.parse> {
  const latestRun = store.listRunsForSession(sessionId)[0];
  const latestFailure = store
    .listHighlights(sessionId)
    .find((highlight) => highlight.type === "failure" || highlight.type === "regression");
  const latestSignal = store.listProductionSignals({ sessionId, limit: 5 })[0];
  const latestRelease = latestRun ? store.listReleases({ runId: latestRun.id })[0] : undefined;

  const tasks: string[] = [];
  const suggestedCommands: string[] = [];
  const risks: string[] = [];

  if (latestSignal?.severity === "critical") {
    tasks.push(`Investigate critical production signal: ${latestSignal.summary}`);
    if (latestRelease && latestRelease.status !== "rolled_back") {
      suggestedCommands.push(`vibent release rollback ${latestRelease.id} --reason "critical signal"`);
    }
    risks.push("Production health degraded.");
  } else if (latestFailure) {
    tasks.push("Fix the latest failing checks before publishing.");
    if (latestFailure.pointers.runId) {
      suggestedCommands.push(`vibent verify ${latestFailure.pointers.runId}`);
      suggestedCommands.push(`vibent replay ${latestFailure.pointers.runId}`);
    }
    risks.push("Recent verification failed.");
  } else if (latestRun) {
    tasks.push("Review latest run and publish when ready.");
    suggestedCommands.push(`vibent verify ${latestRun.id}`);
    suggestedCommands.push(`vibent replay ${latestRun.id}`);
    if (latestRelease && latestRelease.status === "canary") {
      tasks.push(`Promote or rollback canary release ${latestRelease.id}.`);
      suggestedCommands.push(`vibent release promote ${latestRelease.id} --traffic 100`);
      suggestedCommands.push(`vibent release rollback ${latestRelease.id} --reason "canary regression"`);
    }
  } else {
    tasks.push("Start a run for the next change.");
    suggestedCommands.push('vibent run "describe next change"');
  }

  const now = new Date().toISOString();
  const resume = resumePlanSchema.parse({
    id: createId("resume"),
    sessionId,
    tasks,
    suggestedCommands,
    risks,
    createdAt: now,
    updatedAt: now
  });
  store.upsertResumePlan(resume);
  return resume;
}

function buildSnapshot(
  store: FileStore,
  sessionId: string,
  summary: string
): ReturnType<typeof memorySnapshotSchema.parse> {
  const runs = store.listRunsForSession(sessionId);
  const fileCount = new Map<string, number>();
  for (const run of runs.slice(0, 20)) {
    const runWithFiles = run as typeof run & { changedFiles?: string[] };
    for (const file of runWithFiles.changedFiles ?? []) {
      fileCount.set(file, (fileCount.get(file) ?? 0) + 1);
    }
  }
  const touchedFiles = [...fileCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([file]) => file);

  let lastKnownGood: string | null = null;
  for (const run of runs) {
    const evals = store.listEvalsForRun(run.id);
    if (evals.length > 0 && evals.every((evalResult) => evalResult.passed)) {
      lastKnownGood = run.id;
      break;
    }
  }

  const knownFailures = store
    .listHighlights(sessionId)
    .filter((highlight) => highlight.type === "failure")
    .slice(0, 5)
    .map((highlight) => ({
      text: highlight.text,
      runId: highlight.runId ?? undefined,
      links: highlight.pointers.artifacts
    }));

  const snapshot = memorySnapshotSchema.parse({
    id: createId("snap"),
    sessionId,
    touchedFiles,
    touchedSymbols: [],
    keyDecisions: store
      .listSessionEvents(sessionId)
      .filter((event) => event.type === "decision")
      .slice(0, 5)
      .map((event) => String(event.payload.text ?? event.payload.rationale_short ?? "")),
    knownFailures,
    lastKnownGood,
    environmentFingerprint: hashRunManifest({
      goal: process.env.NODE_ENV ?? "dev",
      baseRef: process.version,
      baseSha: process.platform,
      patchPointer: process.cwd(),
      reproducibility: "replayable-locally"
    }),
    testStatusSummary: summary,
    createdAt: new Date().toISOString()
  });

  store.upsertSnapshot(snapshot);
  return snapshot;
}

function createHighlight(
  store: FileStore,
  input: {
    sessionId: string;
    runId?: string | null;
    type: "goal" | "failure" | "fix" | "next_step" | "finding" | "regression";
    text: string;
    pointers?: { runId?: string; files?: string[]; evalIds?: string[]; artifacts?: string[] };
    confidence?: number;
  }
): ReturnType<typeof highlightSchema.parse> {
  const now = new Date().toISOString();
  const highlight = highlightSchema.parse({
    id: createId("hl"),
    sessionId: input.sessionId,
    runId: input.runId ?? null,
    type: input.type,
    text: input.text,
    pointers: {
      runId: input.pointers?.runId,
      files: input.pointers?.files ?? [],
      evalIds: input.pointers?.evalIds ?? [],
      artifacts: input.pointers?.artifacts ?? []
    },
    confidence: input.confidence ?? null,
    createdAt: now,
    updatedAt: now
  });
  store.upsertHighlight(highlight);
  return highlight;
}

function buildReviewResult(
  store: FileStore,
  run: ReturnType<typeof runSchema.parse>,
  commands: string[]
): ReturnType<typeof reviewResultSchema.parse> {
  const findings = [];
  const now = new Date().toISOString();
  const evals = store.listEvalsForRun(run.id);
  const hasPassingEval = evals.some((evalResult) => evalResult.passed);
  const patch = fs.existsSync(run.patchPointer) ? fs.readFileSync(run.patchPointer, "utf8") : "";

  if (!hasPassingEval) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "policy",
        severity: "high",
        title: "Verification missing or failing",
        detail: "Run does not have a passing evaluation. Execute verify before publish.",
        command: null,
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  if (
    /(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[a-z0-9_\-]{8,}/i.test(patch) ||
    /(ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,}|sk-[a-z0-9]{12,})/i.test(patch)
  ) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "security",
        severity: "critical",
        title: "Potential secret exposure in patch",
        detail: "Detected token-like values in patch content. Rotate and remove before publish.",
        command: null,
        artifactPointer: run.patchPointer,
        createdAt: now
      })
    );
  }

  const runWithFiles = run as typeof run & { changedFiles?: string[] };
  const changedFiles = runWithFiles.changedFiles ?? [];
  if (changedFiles.some((file) => file === "pnpm-lock.yaml" || file.endsWith("package.json"))) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "dependency",
        severity: "medium",
        title: "Dependency manifests changed",
        detail: "Dependency files changed; run targeted regression tests.",
        command: "pnpm audit --prod",
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  if (changedFiles.some((file) => file.startsWith("infra/") || file.endsWith(".tf"))) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "release",
        severity: "medium",
        title: "Infrastructure changes detected",
        detail: "Infra updates require staged rollout and rollback readiness.",
        command: "terraform -chdir=infra/terraform fmt -check",
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  if (commands.length > 0) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "lint",
        severity: "info",
        title: "Review commands requested",
        detail: `Requested commands: ${commands.join(" | ")}`,
        command: commands.join(" && "),
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  const blocking = findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  return reviewResultSchema.parse({
    id: createId("review"),
    runId: run.id,
    passed: blocking.length === 0,
    summary:
      blocking.length === 0
        ? `Review passed with ${findings.length} findings.`
        : `Review failed with ${blocking.length} blocking findings.`,
    findings,
    commands,
    createdAt: now
  });
}

export function createApp(): FastifyInstance {
  const config = loadConfig();
  const app = Fastify({ logger: true, requestIdHeader: "x-request-id" });
  const store = new FileStore(config.dataDir);

  fs.mkdirSync(config.artifactsDir, { recursive: true });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", service: "vibent-api" }));

  app.get("/v1/openapi/api", async (_request, reply) => {
    const spec = fs.readFileSync(path.join(process.cwd(), "packages/shared/openapi/api.yaml"), "utf8");
    reply.type("text/yaml");
    return spec;
  });

  app.get("/v1/openapi/agent", async (_request, reply) => {
    const spec = fs.readFileSync(path.join(process.cwd(), "packages/shared/openapi/agent.yaml"), "utf8");
    reply.type("text/yaml");
    return spec;
  });

  app.get("/v1/status", async () => {
    return statusSchema.parse({
      capabilities: [
        "run",
        "verify",
        "review",
        "publish",
        "release",
        "signals",
        "blame",
        "replay",
        "agent-mode",
        "session",
        "memory",
        "resume"
      ],
      repoConnected: store.isRepoConnected(),
      authState: store.isRepoConnected() ? "connected" : "disconnected"
    });
  });

  app.post("/v1/mock/connect", async (request) => {
    const body = request.body as { connected?: boolean };
    store.setRepoConnection(body.connected ?? true);
    return { ok: true, connected: store.isRepoConnected() };
  });

  app.post("/v1/runs", async (request, reply) => {
    const parsed = createRunRequestSchema.parse(request.body ?? {});
    const id = createId("run");
    const now = new Date().toISOString();
    const patchPointer = path.join(config.artifactsDir, `${id}.patch`);
    fs.writeFileSync(
      patchPointer,
      "# Stub patch produced by local provider\n# Replace with real diff on patch/propose\n"
    );

    const session = ensureActiveSession(store, parsed.goal);

    const run = runSchema.parse({
      id,
      goal: parsed.goal,
      baseRef: parsed.baseRef,
      baseSha: "local-head",
      patchPointer,
      evalPointers: [],
      transcriptPointer: null,
      reproducibility: "replayable-locally",
      status: "Draft",
      sessionId: session.id,
      createdAt: now,
      updatedAt: now
    });

    store.upsertRun(run);
    store.linkRunToSession(run.id, session.id);

    const event = sessionEventSchema.parse({
      id: createId("evt"),
      sessionId: session.id,
      runId: run.id,
      ts: now,
      type: "prompt",
      payload: { text: parsed.goal },
      artifactPointer: null
    });
    store.appendSessionEvent(event);

    createHighlight(store, {
      sessionId: session.id,
      runId: run.id,
      type: "goal",
      text: `Goal: ${run.goal}`,
      pointers: { runId: run.id, files: [] }
    });
    buildSnapshot(store, session.id, "Draft run recorded");
    buildResumePlan(store, session.id);

    const manifestHash = hashRunManifest({
      goal: run.goal,
      baseRef: run.baseRef,
      baseSha: run.baseSha,
      patchPointer: run.patchPointer,
      reproducibility: run.reproducibility
    });

    reply.code(201);
    return { run, manifestHash, sessionId: session.id };
  });

  app.get("/v1/runs", async () => {
    return { runs: store.listRuns() };
  });

  app.get("/v1/runs/:runId", async (request, reply) => {
    const params = request.params as { runId: string };
    const run = store.getRun(params.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    return {
      run,
      evals: store.listEvalsForRun(run.id)
    };
  });

  app.post("/v1/evals/plan", async (request) => {
    const body = request.body as { runId: string; changedFiles?: string[] };
    const run = store.getRun(body.runId);
    if (!run) {
      return { error: "Run not found" };
    }
    const commands = suggestCommands(body.changedFiles ?? [], process.cwd());
    return {
      planId: createId("plan"),
      runId: run.id,
      commands
    };
  });

  app.post("/v1/evals", async (request, reply) => {
    const body = request.body as {
      runId: string;
      commands: string[];
      passed: boolean;
      summary: string;
      artifactPointer: string;
    };

    const evalResult = evalResultSchema.parse({
      id: createId("eval"),
      runId: body.runId,
      commands: body.commands,
      passed: body.passed,
      summary: body.summary,
      artifactPointer: body.artifactPointer,
      createdAt: new Date().toISOString()
    });

    store.upsertEval(evalResult);

    const run = store.getRun(body.runId) as (typeof runSchema._type & { sessionId?: string | null }) | undefined;
    if (!run || !run.sessionId) {
      return { eval: evalResult };
    }

    const session = store.getSession(run.sessionId);
    if (!session) {
      return { eval: evalResult };
    }

    if (!body.passed) {
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "failure",
        text: `Failed: ${body.commands.join(", ")}. ${extractTopErrorLine(body.summary)}`,
        pointers: {
          runId: run.id,
          files: (run as typeof run & { changedFiles?: string[] }).changedFiles ?? [],
          evalIds: [evalResult.id],
          artifacts: [body.artifactPointer]
        },
        confidence: 0.9
      });
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text: "Next: inspect failing output and rerun affected suite.",
        pointers: {
          runId: run.id,
          evalIds: [evalResult.id],
          artifacts: [body.artifactPointer]
        }
      });
    } else {
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "fix",
        text: `Verified: ${body.commands.join(", ")} passed.`,
        pointers: {
          runId: run.id,
          files: (run as typeof run & { changedFiles?: string[] }).changedFiles ?? [],
          evalIds: [evalResult.id],
          artifacts: [body.artifactPointer]
        },
        confidence: 0.95
      });
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text: "Next: review and publish evidence when ready.",
        pointers: {
          runId: run.id,
          evalIds: [evalResult.id]
        }
      });
    }

    buildSnapshot(store, session.id, body.summary);
    buildResumePlan(store, session.id);

    return { eval: evalResult };
  });

  app.post("/v1/review/run", async (request, reply) => {
    const body = reviewRunRequestSchema.parse(request.body ?? {});
    const run = store.getRun(body.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = buildReviewResult(store, run, body.commands);
    store.upsertReview(review);

    const runWithSession = run as typeof run & { sessionId?: string | null; changedFiles?: string[] };
    if (runWithSession.sessionId) {
      const session = store.getSession(runWithSession.sessionId);
      if (session) {
        createHighlight(store, {
          sessionId: session.id,
          runId: run.id,
          type: review.passed ? "fix" : "failure",
          text: review.passed ? `Review passed for ${run.id}.` : `Review blocked for ${run.id}.`,
          pointers: {
            runId: run.id,
            files: runWithSession.changedFiles ?? []
          },
          confidence: review.passed ? 0.9 : 0.95
        });
        if (!review.passed) {
          createHighlight(store, {
            sessionId: session.id,
            runId: run.id,
            type: "next_step",
            text: "Next: resolve blocking review findings and rerun `vibent review`.",
            pointers: { runId: run.id, files: runWithSession.changedFiles ?? [] }
          });
        }
        buildSnapshot(store, session.id, review.summary);
        buildResumePlan(store, session.id);
      }
    }

    return { review };
  });

  app.get("/v1/reviews/:runId", async (request, reply) => {
    const params = request.params as { runId: string };
    const run = store.getRun(params.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    return { reviews: store.listReviewsForRun(run.id) };
  });

  app.post("/v1/releases", async (request, reply) => {
    const body = releaseCreateRequestSchema.parse(request.body ?? {});
    const run = store.getRun(body.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = store.latestReviewForRun(run.id);
    if (!review || !review.passed) {
      reply.code(400);
      return { error: "Release requires passing review." };
    }

    const now = new Date().toISOString();
    const release = releaseSchema.parse({
      id: createId("rel"),
      runId: run.id,
      bundleId: null,
      environment: body.environment,
      status: body.trafficPercent >= 100 ? "stable" : "canary",
      trafficPercent: body.trafficPercent,
      version: `${now.slice(0, 10)}-${run.id.slice(-6)}`,
      notes: body.notes,
      createdAt: now,
      updatedAt: now
    });
    store.upsertRelease(release);
    reply.code(201);
    return { release };
  });

  app.get("/v1/releases", async (request) => {
    const query = request.query as { runId?: string };
    return { releases: store.listReleases({ runId: query.runId }) };
  });

  app.post("/v1/releases/promote", async (request, reply) => {
    const body = releasePromoteRequestSchema.parse(request.body ?? {});
    const release = store.getRelease(body.releaseId);
    if (!release) {
      reply.code(404);
      return { error: "Release not found" };
    }
    release.trafficPercent = body.trafficPercent;
    release.status = body.trafficPercent >= 100 ? "stable" : "canary";
    release.updatedAt = new Date().toISOString();
    store.upsertRelease(releaseSchema.parse(release));
    return { release };
  });

  app.post("/v1/releases/rollback", async (request, reply) => {
    const body = releaseRollbackRequestSchema.parse(request.body ?? {});
    const release = store.getRelease(body.releaseId);
    if (!release) {
      reply.code(404);
      return { error: "Release not found" };
    }
    release.status = "rolled_back";
    release.trafficPercent = 0;
    release.notes = release.notes ? `${release.notes}\nRollback: ${body.reason}` : `Rollback: ${body.reason}`;
    release.updatedAt = new Date().toISOString();
    store.upsertRelease(releaseSchema.parse(release));
    return { release };
  });

  app.post("/v1/signals", async (request, reply) => {
    const body = signalIngestRequestSchema.parse(request.body ?? {});
    const run = body.runId ? (store.getRun(body.runId) as (typeof runSchema._type & { sessionId?: string | null }) | undefined) : undefined;
    const runSessionId = run?.sessionId ?? undefined;
    const session =
      (body.sessionId ? store.getSession(body.sessionId) : undefined) ??
      (runSessionId ? store.getSession(runSessionId) : undefined) ??
      store.getActiveSession();

    const signal = productionSignalSchema.parse({
      id: createId("sig"),
      sessionId: session?.id ?? null,
      runId: body.runId ?? null,
      source: body.source,
      type: body.type,
      severity: body.severity,
      summary: body.summary,
      metricValue: body.metricValue ?? null,
      unit: body.unit ?? null,
      createdAt: new Date().toISOString()
    });
    store.appendProductionSignal(signal);

    if (session) {
      createHighlight(store, {
        sessionId: session.id,
        runId: signal.runId ?? null,
        type: signal.severity === "critical" ? "regression" : "finding",
        text: `Signal ${signal.type}: ${signal.summary}`,
        confidence: signal.severity === "critical" ? 0.95 : 0.8
      });
      buildSnapshot(store, session.id, `Signal ${signal.type} ${signal.severity}`);
      buildResumePlan(store, session.id);
    }

    reply.code(201);
    return { signal };
  });

  app.get("/v1/signals/session/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const session = store.getSession(params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    return { signals: store.listProductionSignals({ sessionId: session.id, limit: 50 }) };
  });

  app.post("/v1/publish", async (request, reply) => {
    const parsed = publishRequestSchema.parse(request.body ?? {});
    if (parsed.mode === "pr" && !store.isRepoConnected()) {
      reply.code(400);
      return { error: "Publishing requires GitHub connection." };
    }

    const run = store.getRun(parsed.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = store.latestReviewForRun(run.id);
    if (!review || !review.passed) {
      reply.code(400);
      return { error: "Publishing requires a passing review." };
    }

    const evals = store.listEvalsForRun(run.id);
    const passed = evals.every((entry) => entry.passed);
    const summary = [
      `Goal: ${run.goal}`,
      `Diff: ${run.patchPointer}`,
      `Tests: ${evals.map((entry) => entry.commands.join(", ")).join(" | ") || "none"}`,
      `Results: ${passed ? "pass" : "fail"}`,
      `Reproduce: vibent replay ${run.id}`
    ].join("\n");

    if (parsed.mode === "pr" && config.mockGithub) {
      const mock = createMockGithubClient();
      await publishEvidence(mock, {
        owner: "local",
        repo: "local",
        prNumber: parsed.prNumber ?? 1,
        headSha: run.baseSha,
        summary,
        passed
      });
    }

    const bundle = store.saveBundle({
      id: createId("bundle"),
      runId: run.id,
      mode: parsed.mode,
      prUrl: parsed.prUrl,
      summary,
      publishedAt: new Date().toISOString()
    });

    return { bundle };
  });

  app.get("/v1/sessions", async () => {
    return { sessions: store.listSessions() };
  });

  app.get("/v1/sessions/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const session = store.getSession(params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    return {
      session,
      runs: store.listRunsForSession(session.id),
      highlights: store.listHighlights(session.id).slice(0, 10),
      notes: store.listSessionEvents(session.id).filter((event) => event.type === "note").slice(0, 20),
      signals: store.listProductionSignals({ sessionId: session.id, limit: 20 }),
      releases: store
        .listRunsForSession(session.id)
        .flatMap((run) => store.listReleases({ runId: run.id }))
        .slice(0, 20),
      resume: store.latestResumePlan(session.id) ?? buildResumePlan(store, session.id),
      snapshot: store.latestSnapshot(session.id),
      changedSinceLastKnownGood: changedSinceLastKnownGood(store, session.id)
    };
  });

  app.post("/v1/session/start", async (request) => {
    const body = sessionStartRequestSchema.parse(request.body ?? {});
    const now = new Date().toISOString();
    const session = sessionSchema.parse({
      id: createId("sess"),
      repoId: body.repoId ?? "local-repo",
      startedAt: now,
      lastActiveAt: now,
      createdBy: body.createdBy ?? "local-user",
      branchRef: body.branchRef ?? body.from ?? null,
      title: body.title ?? "Session",
      status: "active",
      pinned: false,
      summary: "",
      linkedRuns: []
    });

    store.upsertSession(session);
    store.setActiveSession(session.id);

    if (body.from) {
      const run = store.getRun(body.from);
      if (run) {
        store.linkRunToSession(run.id, session.id);
      }
    }

    const snapshot = buildSnapshot(store, session.id, "Session started");
    const resume = buildResumePlan(store, session.id);
    return { session, snapshot, resume };
  });

  app.post("/v1/session/continue", async (request, reply) => {
    const body = sessionContinueRequestSchema.parse(request.body ?? {});
    const session = store.getSession(body.sessionId);
    if (!session || session.status !== "active") {
      reply.code(404);
      return { error: "Session not found or archived" };
    }
    session.lastActiveAt = new Date().toISOString();
    store.upsertSession(session);
    store.setActiveSession(session.id);
    const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session.id);
    return { session, resume };
  });

  app.get("/v1/session/status", async (_request, reply) => {
    const session = store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "No active session" };
    }
    return {
      session,
      highlights: store.listHighlights(session.id).slice(0, 10),
      signals: store.listProductionSignals({ sessionId: session.id, limit: 10 }),
      resume: store.latestResumePlan(session.id) ?? buildResumePlan(store, session.id),
      changedSinceLastKnownGood: changedSinceLastKnownGood(store, session.id)
    };
  });

  app.post("/v1/session/note", async (request, reply) => {
    const body = sessionNoteRequestSchema.parse(request.body ?? {});
    const session = body.sessionId ? store.getSession(body.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const note = sessionEventSchema.parse({
      id: createId("evt"),
      sessionId: session.id,
      runId: null,
      ts: new Date().toISOString(),
      type: "note",
      payload: { text: body.text },
      artifactPointer: null
    });
    store.appendSessionEvent(note);
    createHighlight(store, {
      sessionId: session.id,
      type: "finding",
      text: `Note: ${body.text}`
    });
    const snapshot = buildSnapshot(store, session.id, "Note added");
    return { note, snapshot };
  });

  app.post("/v1/session/pin", async (request, reply) => {
    const body = request.body as { sessionId?: string; pinned?: boolean };
    if (!body.sessionId) {
      reply.code(400);
      return { error: "sessionId is required" };
    }
    const session = store.getSession(body.sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    session.pinned = body.pinned ?? true;
    session.lastActiveAt = new Date().toISOString();
    store.upsertSession(session);
    return { session };
  });

  app.post("/v1/memory/query", async (request, reply) => {
    const body = memoryQueryRequestSchema.parse(request.body ?? {});
    const session = body.sessionId ? store.getSession(body.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }

    const qTokens = tokenize(body.query ?? "");
    const files = body.files.map((entry) => entry.toLowerCase());
    const highlights = store
      .listHighlights(session.id)
      .map((highlight) => {
        const textTokens = tokenize(highlight.text);
        const fileTokens = highlight.pointers.files.map((entry) => entry.toLowerCase());
        const score =
          recencyScore(highlight.createdAt) * 0.45 +
          overlapScore(qTokens, textTokens) * 0.3 +
          overlapScore(files, fileTokens) * 0.25;
        return { highlight, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, body.limit)
      .map((entry) => entry.highlight);

    const priorRuns = store
      .listRunsForSession(session.id)
      .map((run) => {
        const runFiles = ((run as typeof run & { changedFiles?: string[] }).changedFiles ?? []).map((entry) =>
          entry.toLowerCase()
        );
        const score =
          recencyScore(run.createdAt) * 0.5 +
          overlapScore(qTokens, tokenize(run.goal)) * 0.2 +
          overlapScore(files, runFiles) * 0.3;
        return { run, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, body.limit)
      .map((entry) => entry.run);

    return {
      topHighlights: highlights,
      relevantPriorRuns: priorRuns,
      relevantFailures: highlights.filter((entry) => entry.type === "failure"),
      relevantFixes: highlights.filter((entry) => entry.type === "fix"),
      suggestedNextSteps: store
        .listHighlights(session.id)
        .filter((entry) => entry.type === "next_step")
        .slice(0, body.limit)
        .map((entry) => entry.text)
    };
  });

  app.get("/v1/memory/snapshot", async (request, reply) => {
    const query = request.query as { sessionId?: string };
    const session = query.sessionId ? store.getSession(query.sessionId) : store.getActiveSession();
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
    const body = resumePlanRequestSchema.parse(request.body ?? {});
    const session = body.sessionId ? store.getSession(body.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const resume = buildResumePlan(store, session.id);
    return { resume };
  });

  app.post("/v1/webhooks/github", async (request, reply) => {
    const payload = request.body ? JSON.stringify(request.body) : "";
    const signature = request.headers["x-hub-signature-256"] as string | undefined;

    const ok = validateGithubSignature(payload, signature, config.githubWebhookSecret);
    if (!ok) {
      reply.code(401);
      return { error: "Invalid webhook signature" };
    }

    return { accepted: true };
  });

  return app;
}
