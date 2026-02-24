import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const envBackup = { ...process.env };

afterEach(() => {
  process.env = { ...envBackup };
});

describe("publish modes and release flow", () => {
  it("supports direct publish and release lifecycle", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-api-data-"));
    const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibent-api-artifacts-"));
    process.env.VIBENT_DATA_DIR = dataDir;
    process.env.VIBENT_ARTIFACTS_DIR = artifactsDir;
    process.env.VIBENT_MOCK_GITHUB = "true";

    const app = createApp();

    const runRes = await app.inject({
      method: "POST",
      url: "/v1/runs",
      payload: { goal: "ship direct publish" }
    });
    expect(runRes.statusCode).toBe(201);
    const runId = (runRes.json() as { run: { id: string } }).run.id;

    const evalRes = await app.inject({
      method: "POST",
      url: "/v1/evals",
      payload: {
        runId,
        commands: ["echo ok"],
        passed: true,
        summary: "passed",
        artifactPointer: path.join(artifactsDir, "eval.log")
      }
    });
    expect(evalRes.statusCode).toBe(200);

    const reviewRes = await app.inject({
      method: "POST",
      url: "/v1/review/run",
      payload: { runId }
    });
    expect(reviewRes.statusCode).toBe(200);
    expect((reviewRes.json() as { review: { passed: boolean } }).review.passed).toBe(true);

    const prPublish = await app.inject({
      method: "POST",
      url: "/v1/publish",
      payload: { runId, mode: "pr" }
    });
    expect(prPublish.statusCode).toBe(400);

    const directPublish = await app.inject({
      method: "POST",
      url: "/v1/publish",
      payload: { runId, mode: "direct" }
    });
    expect(directPublish.statusCode).toBe(200);

    const createRelease = await app.inject({
      method: "POST",
      url: "/v1/releases",
      payload: { runId, environment: "dev", trafficPercent: 20 }
    });
    expect(createRelease.statusCode).toBe(201);
    const releaseId = (createRelease.json() as { release: { id: string } }).release.id;

    const promote = await app.inject({
      method: "POST",
      url: "/v1/releases/promote",
      payload: { releaseId, trafficPercent: 100 }
    });
    expect(promote.statusCode).toBe(200);

    const rollback = await app.inject({
      method: "POST",
      url: "/v1/releases/rollback",
      payload: { releaseId, reason: "regression" }
    });
    expect(rollback.statusCode).toBe(200);

    await app.close();
  });
});
