import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAutomatedReview } from "../src/lib/review.js";
import { LocalStore, RunRecord } from "../src/lib/store.js";

function makeRun(id: string, sessionId: string): RunRecord {
  const now = new Date().toISOString();
  return {
    id,
    goal: "review change",
    baseRef: "HEAD",
    baseSha: "abc",
    patchPointer: "",
    evalPointers: [],
    transcriptPointer: null,
    reproducibility: "replayable-locally",
    status: "Draft",
    changedFiles: ["apps/api/src/app.ts"],
    sessionId,
    createdAt: now,
    updatedAt: now
  };
}

describe("automated review", () => {
  it("blocks when verification is missing", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-review-"));
    const store = new LocalStore(repoRoot);
    const session = store.createSession({ title: "review session" });
    const run = makeRun("run_review_1", session.id);
    store.saveRun(run, "diff --git a/a.txt b/a.txt");

    const review = await runAutomatedReview({
      store,
      run,
      repoRoot,
      commands: ["true"]
    });

    expect(review.passed).toBe(false);
    expect(review.findings.some((finding) => finding.severity === "high")).toBe(true);
  });

  it("passes when eval is green and no blocking issues are found", async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-review-pass-"));
    const store = new LocalStore(repoRoot);
    const session = store.createSession({ title: "review pass session" });
    const run = makeRun("run_review_2", session.id);
    store.saveRun(run, "diff --git a/a.txt b/a.txt");

    store.saveEval({
      id: "eval_ok",
      runId: run.id,
      commands: ["echo ok"],
      passed: true,
      summary: "ok",
      artifactPointer: store.artifactPath("eval_ok.log"),
      createdAt: new Date().toISOString()
    });

    const review = await runAutomatedReview({
      store,
      run: store.getRun(run.id) as RunRecord,
      repoRoot,
      commands: ["true"]
    });

    expect(review.passed).toBe(true);
    expect(review.findings.every((finding) => finding.severity !== "high" && finding.severity !== "critical")).toBe(true);
  });
});
