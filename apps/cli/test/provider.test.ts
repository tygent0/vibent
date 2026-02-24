import { afterEach, describe, expect, it } from "vitest";
import { proposePatch } from "../src/lib/agentProvider.js";

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe("agent provider", () => {
  it("uses existing git diff when available", async () => {
    const diff = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new";
    const result = await proposePatch({ goal: "update file", existingDiff: diff });
    expect(result.provider).toBe("git-diff");
    expect(result.patch).toBe(diff);
  });

  it("falls back to stub patch when remote provider config is incomplete", async () => {
    process.env.VIBENT_PROVIDER = "openai-compatible";
    delete process.env.VIBENT_PROVIDER_API_KEY;
    process.env.VIBENT_PROVIDER_MAX_ATTEMPTS = "2";

    const result = await proposePatch({ goal: "add endpoint", existingDiff: "" });
    expect(result.provider).toBe("stub");
    expect(result.attempts).toBe(2);
    expect(result.patch).toContain("stub patch for goal");
  });
});
