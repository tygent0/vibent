import fs from "node:fs";
import path from "node:path";
import { createId } from "../lib/ids.js";
import { getChangedFiles, getCurrentDiff, getHeadSha, getRepoRoot } from "../lib/git.js";
import { sha256 } from "../lib/hash.js";
import { buildResumePlan, buildSnapshot, findSimilarFailedRun } from "../lib/memory.js";
import { proposePatch } from "../lib/agentProvider.js";
import { LocalStore, RunRecord } from "../lib/store.js";

function hashFileIfExists(repoRoot: string, relativePath: string): string | null {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  if (!fs.statSync(absolutePath).isFile()) return null;
  return sha256(fs.readFileSync(absolutePath, "utf8"));
}

export async function runCommandHandler(goal: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const session = store.ensureActiveSession(goal);
  const baseSha = await getHeadSha(repoRoot);
  const changedFiles = await getChangedFiles(repoRoot);
  const diff = await getCurrentDiff(repoRoot);
  const patchProposal = await proposePatch({
    goal,
    existingDiff: diff,
    changedFiles,
    scopeHints: undefined
  });
  const runId = createId("run");
  const now = new Date().toISOString();

  const run: RunRecord = {
    id: runId,
    goal,
    baseRef: "HEAD",
    baseSha,
    patchPointer: "",
    evalPointers: [],
    transcriptPointer: null,
    reproducibility: "replayable-locally",
    status: "Draft",
    changedFiles,
    sessionId: session.id,
    createdAt: now,
    updatedAt: now
  };

  store.saveRun(run, patchProposal.patch);
  store.linkRunToSession(run.id, session.id);
  store.createEvent({
    sessionId: session.id,
    runId: run.id,
    type: "prompt",
    payload: { text: goal }
  });
  store.createEvent({
    sessionId: session.id,
    runId: run.id,
    type: "command",
    payload: { cmd: "git diff --name-only", exit_code: 0, stdout_hash: sha256(changedFiles.join("\n")) }
  });
  store.createEvent({
    sessionId: session.id,
    runId: run.id,
    type: "command",
    payload: { cmd: "git diff", exit_code: 0, stdout_hash: sha256(diff) }
  });
  for (const changedFile of changedFiles) {
    store.createEvent({
      sessionId: session.id,
      runId: run.id,
      type: "file_read",
      payload: {
        path: changedFile,
        hash: hashFileIfExists(repoRoot, changedFile)
      }
    });
  }
  store.createEvent({
    sessionId: session.id,
    runId: run.id,
    type: "file_write",
    payload: {
      path: run.patchPointer,
      hash: sha256(patchProposal.patch)
    }
  });
  store.createHighlight({
    sessionId: session.id,
    runId: run.id,
    type: "goal",
    text: `Goal: ${goal}`,
    pointers: { runId: run.id, files: changedFiles }
  });
  buildSnapshot(store, session, "Draft run recorded", process.env);
  buildResumePlan(store, session);

  const manifestHash = sha256(
    JSON.stringify({ goal: run.goal, baseRef: run.baseRef, baseSha: run.baseSha, patchPointer: run.patchPointer })
  );

  const riskHints = [
    changedFiles.some((f) => f.includes("api") || f.includes("routes")) ? "API touched" : null,
    changedFiles.some((f) => f.includes("infra") || f.endsWith(".tf")) ? "Infra touched" : null
  ].filter(Boolean);

  const similarFailed = findSimilarFailedRun(store, session.id, run);

  console.log(`Run: ${runId}`);
  console.log(`Session: ${session.id}`);
  console.log(`Goal: ${goal}`);
  console.log(`Files changed: ${changedFiles.length}`);
  console.log(`Estimated tests affected: ${Math.max(1, Math.min(changedFiles.length, 8))}`);
  console.log(`Risks: ${riskHints.length ? riskHints.join(", ") : "none"}`);
  console.log(`Manifest hash: ${manifestHash}`);
  console.log(`Provider: ${patchProposal.provider} (attempts=${patchProposal.attempts})`);
  if (patchProposal.notes.length > 0) {
    console.log(`Provider notes: ${patchProposal.notes.join(" | ")}`);
  }
  if (similarFailed) {
    console.log(
      `Heads up: similar change failed in Run ${similarFailed.run.id} because ${similarFailed.reason}. See: vibent session show ${session.id}`
    );
  }
}
