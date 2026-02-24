import { describe, expect, it } from "vitest";
import { generateVerifyHighlights } from "../src/lib/memory.js";
import { EvalRecord, RunRecord } from "../src/lib/store.js";

function makeRun(): RunRecord {
  const now = new Date().toISOString();
  return {
    id: "run_test",
    goal: "fix failing suite",
    baseRef: "HEAD",
    baseSha: "abc",
    patchPointer: ".vibent/runs/run_test/patch.diff",
    evalPointers: [],
    transcriptPointer: null,
    reproducibility: "replayable-locally",
    status: "Draft",
    changedFiles: ["apps/api/src/app.ts"],
    sessionId: "sess_test",
    createdAt: now,
    updatedAt: now
  };
}

function makeEval(passed: boolean): EvalRecord {
  return {
    id: "eval_test",
    runId: "run_test",
    commands: ["pnpm --filter @vibent/api test"],
    passed,
    summary: passed ? "All checks passed" : "At least one check failed",
    artifactPointer: ".vibent/artifacts/eval_test.log",
    createdAt: new Date().toISOString()
  };
}

describe("highlight generation", () => {
  it("creates failure + next step highlights when verification fails", () => {
    const highlights = generateVerifyHighlights({
      run: makeRun(),
      evalResult: makeEval(false),
      redactedLogs: "Error: expected 200 to equal 201"
    });

    expect(highlights[0]?.type).toBe("failure");
    expect(highlights[0]?.text).toContain("Top error");
    expect(highlights[1]?.type).toBe("next_step");
  });

  it("creates fix + next step highlights when verification passes", () => {
    const highlights = generateVerifyHighlights({
      run: makeRun(),
      evalResult: makeEval(true),
      redactedLogs: "ok"
    });

    expect(highlights[0]?.type).toBe("fix");
    expect(highlights[0]?.text).toContain("Verified");
    expect(highlights[1]?.type).toBe("next_step");
  });
});
