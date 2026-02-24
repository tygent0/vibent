import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateGithubSignature } from "../src/lib/webhook.js";

describe("webhook signature", () => {
  it("validates sha256 signature", () => {
    const payload = JSON.stringify({ action: "opened" });
    const secret = "dev-secret";
    const digest = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const signature = `sha256=${digest}`;

    expect(validateGithubSignature(payload, signature, secret)).toBe(true);
    expect(validateGithubSignature(payload, "sha256=bad", secret)).toBe(false);
  });
});
