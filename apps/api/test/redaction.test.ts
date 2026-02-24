import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/lib/redact.js";

describe("redaction", () => {
  it("redacts common token patterns", () => {
    const input = "token=ghp_abcdefghijklmnopqrstuvwx password=my-secret";
    const output = redactSecrets(input);

    expect(output).not.toContain("ghp_");
    expect(output).not.toContain("my-secret");
    expect(output).toContain("[REDACTED]");
  });

  it("redacts denylist entries", () => {
    const output = redactSecrets("hello super-secret", ["super-secret"]);
    expect(output).toContain("[REDACTED]");
  });
});
