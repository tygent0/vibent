import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { querySessionMemory } from "../src/lib/memory.js";
import { HighlightRecord, LocalStore, RunRecord } from "../src/lib/store.js";

function makeRun(runId: string, goal: string, files: string[], sessionId: string): RunRecord {
  const now = new Date().toISOString();
  return {
    id: runId,
    goal,
    baseRef: "HEAD",
    baseSha: "abc",
    patchPointer: "",
    evalPointers: [],
    transcriptPointer: null,
    reproducibility: "replayable-locally",
    status: "Draft",
    changedFiles: files,
    sessionId,
    createdAt: now,
    updatedAt: now
  };
}

describe("memory query ranking", () => {
  it("prioritizes recency + file overlap + keyword match", () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-memory-query-"));
    const store = new LocalStore(repoRoot);
    const session = store.createSession({ title: "search ranking" });
    const runA = makeRun("run_a", "fix api auth crash", ["apps/api/src/app.ts"], session.id);
    const runB = makeRun("run_b", "update landing hero copy", ["apps/web/app/page.tsx"], session.id);
    store.saveRun(runA, "diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts");
    store.saveRun(runB, "diff --git a/apps/web/app/page.tsx b/apps/web/app/page.tsx");

    const now = new Date().toISOString();
    const relevantHighlight: HighlightRecord = {
      id: "hl_relevant",
      sessionId: session.id,
      runId: runA.id,
      type: "failure",
      text: "API auth test failed with token mismatch",
      pointers: {
        runId: runA.id,
        files: ["apps/api/src/app.ts"],
        evalIds: [],
        artifacts: []
      },
      confidence: 0.9,
      createdAt: now,
      updatedAt: now
    };
    const irrelevantHighlight: HighlightRecord = {
      id: "hl_irrelevant",
      sessionId: session.id,
      runId: runB.id,
      type: "finding",
      text: "Homepage card spacing updated",
      pointers: {
        runId: runB.id,
        files: ["apps/web/app/page.tsx"],
        evalIds: [],
        artifacts: []
      },
      confidence: 0.9,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    };

    store.saveHighlight(relevantHighlight);
    store.saveHighlight(irrelevantHighlight);

    const result = querySessionMemory(store, session, {
      query: "api auth failure",
      files: ["apps/api/src/app.ts"],
      limit: 2
    });

    expect(result.highlights[0]?.id).toBe("hl_relevant");
    expect(result.priorRuns[0]?.id).toBe("run_a");
  });
});
