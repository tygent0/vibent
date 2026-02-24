import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvalRecord, LocalStore, RunRecord } from "../src/lib/store.js";

function makeRun(id: string, sessionId: string): RunRecord {
  const now = new Date().toISOString();
  return {
    id,
    goal: "retention test",
    baseRef: "HEAD",
    baseSha: "abc",
    patchPointer: "",
    evalPointers: [],
    transcriptPointer: null,
    reproducibility: "replayable-locally",
    status: "Draft",
    changedFiles: ["apps/cli/src/lib/store.ts"],
    sessionId,
    createdAt: now,
    updatedAt: now
  };
}

describe("retention cleanup", () => {
  it("removes old unpinned events/artifacts and keeps pinned references", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-retention-"));
    const store = new LocalStore(repoRoot);
    const oldTs = "2020-01-01T00:00:00.000Z";

    const pinnedSession = store.createSession({ title: "Pinned" });
    store.pinSession(pinnedSession.id, true);
    const regularSession = store.createSession({ title: "Regular" });

    store.createEvent({ sessionId: regularSession.id, type: "note", payload: { text: "old regular event" }, ts: oldTs });
    store.createEvent({ sessionId: pinnedSession.id, type: "note", payload: { text: "old pinned event" }, ts: oldTs });

    const pinnedRun = makeRun("run_pinned", pinnedSession.id);
    store.saveRun(pinnedRun, "diff --git a/a.ts b/a.ts");
    const protectedArtifact = store.artifactPath("protected.log");
    fs.writeFileSync(protectedArtifact, "keep me");

    const evalResult: EvalRecord = {
      id: "eval_pinned",
      runId: pinnedRun.id,
      commands: ["echo ok"],
      passed: true,
      summary: "ok",
      artifactPointer: protectedArtifact,
      createdAt: new Date().toISOString()
    };
    store.saveEval(evalResult);

    const removableArtifact = store.artifactPath("remove.log");
    fs.writeFileSync(removableArtifact, "remove me");

    const veryOld = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(protectedArtifact, veryOld, veryOld);
    fs.utimesSync(removableArtifact, veryOld, veryOld);

    const result = store.cleanupRetention({ eventRetentionDays: 30, artifactRetentionDays: 14 });
    expect(result.removedEvents).toBeGreaterThanOrEqual(1);
    expect(result.removedArtifacts).toBe(1);
    expect(fs.existsSync(protectedArtifact)).toBe(true);
    expect(fs.existsSync(removableArtifact)).toBe(false);
  });
});
