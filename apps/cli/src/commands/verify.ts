import fs from "node:fs";
import { createId } from "../lib/ids.js";
import { getChangedFiles, getRepoRoot } from "../lib/git.js";
import { sha256 } from "../lib/hash.js";
import { buildResumePlan, buildSnapshot, generateVerifyHighlights } from "../lib/memory.js";
import { redactSecrets } from "../lib/redact.js";
import { runCommand } from "../lib/shell.js";
import { LocalStore } from "../lib/store.js";
import { planCommands } from "../lib/testPlanner.js";

function commandsMatch(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export async function verifyCommandHandler(runIdArg?: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const run = runIdArg ? store.getRun(runIdArg) : store.latestRun();

  if (!run) {
    throw new Error("No run found. Execute vibent run first.");
  }

  const changedFiles = run.changedFiles.length ? run.changedFiles : await getChangedFiles(repoRoot);
  const commands = planCommands(repoRoot, changedFiles);
  const envFingerprint = sha256(
    JSON.stringify({
      node: process.version,
      userAgent: process.env.npm_config_user_agent ?? "",
      shell: process.env.SHELL ?? "",
      cwd: repoRoot
    })
  );
  const existingEval = store
    .getEvals(run.id)
    .find(
      (evalResult) =>
        evalResult.passed &&
        evalResult.environmentFingerprint === envFingerprint &&
        commandsMatch(evalResult.commands, commands)
    );

  const session = run.sessionId ? store.getSession(run.sessionId) : store.ensureActiveSession(run.goal);
  if (session && !run.sessionId) {
    store.linkRunToSession(run.id, session.id);
  }

  if (existingEval) {
    if (session) {
      store.createEvent({
        sessionId: session.id,
        runId: run.id,
        type: "test_run",
        payload: {
          suite: existingEval.commands.join(" | "),
          result: "cached-pass",
          duration_ms: 0,
          eval_id: existingEval.id
        }
      });
      store.createHighlight({
        sessionId: session.id,
        runId: run.id,
        type: "fix",
        text: `Reused cached verification from ${existingEval.id} in same environment.`,
        pointers: {
          runId: run.id,
          files: run.changedFiles,
          evalIds: [existingEval.id],
          artifacts: [existingEval.artifactPointer]
        },
        confidence: 0.95
      });
      buildSnapshot(store, session, "Verification reused from cache", process.env);
      buildResumePlan(store, session);
    }
    console.log(`Run: ${run.id}`);
    console.log(`What ran: ${commands.join(" | ")}`);
    console.log(`Result: passed (cached eval ${existingEval.id})`);
    console.log(`Logs: ${existingEval.artifactPointer}`);
    return;
  }

  const logs: string[] = [];
  let passed = true;

  for (const cmd of commands) {
    const startedAt = Date.now();
    const result = await runCommand(cmd, repoRoot);
    logs.push(`$ ${cmd}\n${result.stdout}${result.stderr}`);
    if (session) {
      store.createEvent({
        sessionId: session.id,
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
        sessionId: session.id,
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
  const artifactPath = store.artifactPath(`${evalId}.log`);
  const redactedLogs = redactSecrets(logs.join("\n\n"));
  fs.writeFileSync(artifactPath, redactedLogs);

  const evalResult = {
    id: evalId,
    runId: run.id,
    commands,
    passed,
    summary: passed ? "All checks passed" : "At least one check failed",
    artifactPointer: artifactPath,
    environmentFingerprint: envFingerprint,
    createdAt: new Date().toISOString()
  };
  store.saveEval(evalResult);

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

    store.createEvent({
      sessionId: session.id,
      runId: run.id,
      type: passed ? "build" : "error",
      payload: {
        summary: evalResult.summary,
        eval_id: evalResult.id
      },
      artifactPointer: artifactPath
    });

    buildSnapshot(store, session, evalResult.summary, process.env);
    buildResumePlan(store, session);
  }

  console.log(`Run: ${run.id}`);
  console.log(`What ran: ${commands.join(" | ")}`);
  console.log(`Result: ${passed ? "passed" : "failed"}`);
  console.log(`Logs: ${artifactPath}`);
}
