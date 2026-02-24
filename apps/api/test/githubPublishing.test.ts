import { describe, expect, it, vi } from "vitest";
import { publishEvidence } from "../src/lib/github.js";

describe("github publishing", () => {
  it("updates check and rolling comment in place", async () => {
    const client = {
      checks: {
        listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [{ id: 99, name: "Vibent Evidence" }] } }),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({})
      },
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: [{ id: 42, body: "<!-- vibent-evidence --> old" }] }),
        updateComment: vi.fn().mockResolvedValue({}),
        createComment: vi.fn().mockResolvedValue({})
      }
    };

    await publishEvidence(client, {
      owner: "o",
      repo: "r",
      prNumber: 1,
      headSha: "abc",
      summary: "ok",
      passed: true
    });

    expect(client.checks.update).toHaveBeenCalledOnce();
    expect(client.checks.create).not.toHaveBeenCalled();
    expect(client.issues.updateComment).toHaveBeenCalledOnce();
    expect(client.issues.createComment).not.toHaveBeenCalled();
  });
});
