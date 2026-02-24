import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeVerification } from "../src/verify.js";

describe("executeVerification", () => {
  it("writes artifact logs", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-worker-"));
    const result = await executeVerification({
      runId: "run_test",
      commands: ["echo hello"],
      cwd: tmp,
      artifactsDir: tmp
    });

    expect(result.passed).toBe(true);
    expect(fs.existsSync(result.artifactPointer)).toBe(true);
  });
});
