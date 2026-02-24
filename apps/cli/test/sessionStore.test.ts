import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStore, RunRecord } from "../src/lib/store.js";

function createRun(runId: string, sessionId: string): RunRecord {
  const now = new Date().toISOString();
  return {
    id: runId,
    goal: "ship session memory",
    baseRef: "HEAD",
    baseSha: "abc123",
    patchPointer: "",
    evalPointers: [],
    transcriptPointer: null,
    reproducibility: "replayable-locally",
    status: "Draft",
    changedFiles: ["apps/cli/src/index.ts"],
    sessionId,
    createdAt: now,
    updatedAt: now
  };
}

describe("session store", () => {
  it("creates session and links runs", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-session-store-"));
    const store = new LocalStore(repoRoot);
    const session = store.createSession({ title: "Context drift work" });
    const run = createRun("run_test_1", session.id);

    store.saveRun(run, "diff --git a/a.ts b/a.ts");

    const saved = store.getSession(session.id);
    expect(saved).not.toBeNull();
    expect(saved?.linkedRuns).toContain(run.id);
    expect(store.getActiveSessionId()).toBe(session.id);
    expect(store.listRunsForSession(session.id).map((entry) => entry.id)).toContain(run.id);
  });
});
