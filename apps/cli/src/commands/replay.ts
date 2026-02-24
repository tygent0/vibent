import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../lib/git.js";
import { buildResumePlan, buildSnapshot } from "../lib/memory.js";
import { runCommand } from "../lib/shell.js";
import { LocalStore } from "../lib/store.js";
import { planCommands } from "../lib/testPlanner.js";

export async function replayCommandHandler(runId: string, options?: { withSession?: boolean }): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const run = store.getRun(runId);
  if (!run) {
    throw new Error("Run not found");
  }

  const session = run.sessionId ? store.getSession(run.sessionId) : null;
  if (options?.withSession && session) {
    store.continueSession(session.id);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-replay-"));
  const replayRepo = path.join(tempDir, "repo");

  const clone = await runCommand(`git clone --no-checkout ${repoRoot} ${replayRepo}`, repoRoot);
  if (clone.code !== 0) {
    throw new Error(clone.stderr || "Failed to prepare replay workspace");
  }

  await runCommand(`git checkout ${run.baseSha}`, replayRepo);
  const patch = fs.readFileSync(run.patchPointer, "utf8");
  fs.writeFileSync(path.join(replayRepo, "vibent.patch"), patch);
  const apply = await runCommand("git apply vibent.patch", replayRepo);

  const commands = planCommands(repoRoot, run.changedFiles);
  const runResults: string[] = [];
  let passed = apply.code === 0;

  if (passed) {
    for (const cmd of commands) {
      const result = await runCommand(cmd, replayRepo);
      runResults.push(`$ ${cmd}\n${result.stdout}${result.stderr}`);
      if (result.code !== 0) {
        passed = false;
        break;
      }
    }
  }

  if (session) {
    store.createEvent({
      sessionId: session.id,
      runId: run.id,
      type: "command",
      payload: {
        cmd: `git apply ${run.patchPointer}`,
        exit_code: apply.code
      }
    });
    store.createHighlight({
      sessionId: session.id,
      runId: run.id,
      type: passed ? "fix" : "failure",
      text: passed
        ? `Replay succeeded for run ${run.id}.`
        : `Replay failed for run ${run.id}. Patch apply ${apply.code === 0 ? "passed" : "failed"}.`,
      pointers: {
        runId: run.id,
        files: run.changedFiles,
        evalIds: [],
        artifacts: [run.patchPointer]
      }
    });
    buildSnapshot(store, session, passed ? "Replay passed" : "Replay failed", process.env);
    buildResumePlan(store, session);
  }

  console.log(`Replay workspace: ${replayRepo}`);
  console.log(`Patch apply: ${apply.code === 0 ? "ok" : "failed"}`);
  console.log(`Verification: ${passed ? "passed" : "failed"}`);
  if (session) {
    console.log(`Session: ${session.id}`);
  }

  if (runResults.length) {
    console.log(runResults.join("\n\n"));
  }
}
