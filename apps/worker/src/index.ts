import Fastify from "fastify";
import cors from "@fastify/cors";
import fs from "node:fs";
import path from "node:path";
import { executeVerification } from "./verify.js";

const app = Fastify({ logger: true });

app.register(cors, { origin: true });

app.get("/health", async () => ({ status: "ok", service: "vibent-worker" }));

app.post("/v1/worker/verify", async (request, reply) => {
  const body = request.body as { runId: string; commands: string[]; cwd?: string };
  if (!body?.runId || !Array.isArray(body.commands) || body.commands.length === 0) {
    reply.code(400);
    return { error: "runId and commands are required" };
  }

  const result = await executeVerification({
    runId: body.runId,
    commands: body.commands,
    cwd: body.cwd ?? process.cwd(),
    artifactsDir: process.env.VIBENT_ARTIFACTS_DIR ?? "artifacts"
  });

  return result;
});

app.post("/v1/cleanup", async () => {
  const artifactsDir = process.env.VIBENT_ARTIFACTS_DIR ?? "artifacts";
  const sessionEventsDir = process.env.VIBENT_SESSION_EVENTS_DIR ?? ".vibent/events";
  const pinnedSessionsFile = process.env.VIBENT_PINNED_SESSIONS_FILE ?? ".vibent/pinned-sessions.json";
  const retentionDays = Number(process.env.VIBENT_ARTIFACT_RETENTION_DAYS ?? 14);
  const sessionEventRetentionDays = Number(process.env.VIBENT_SESSION_EVENT_RETENTION_DAYS ?? 30);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const eventCutoff = Date.now() - sessionEventRetentionDays * 24 * 60 * 60 * 1000;
  const pinnedSessions = new Set<string>(
    fs.existsSync(pinnedSessionsFile)
      ? (JSON.parse(fs.readFileSync(pinnedSessionsFile, "utf8")) as string[])
      : []
  );

  if (!fs.existsSync(artifactsDir)) {
    return { ok: true, cleanedArtifacts: 0, cleanedSessionEvents: 0 };
  }

  let cleanedArtifacts = 0;
  for (const entry of fs.readdirSync(artifactsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(artifactsDir, entry.name);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      cleanedArtifacts += 1;
    }
  }

  let cleanedSessionEvents = 0;
  if (fs.existsSync(sessionEventsDir)) {
    for (const entry of fs.readdirSync(sessionEventsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(sessionEventsDir, entry.name);
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { sessionId?: string; ts?: string };
      if (!payload.ts || !payload.sessionId) continue;
      if (pinnedSessions.has(payload.sessionId)) continue;
      if (new Date(payload.ts).getTime() < eventCutoff) {
        fs.unlinkSync(filePath);
        cleanedSessionEvents += 1;
      }
    }
  }

  return { ok: true, cleanedArtifacts, cleanedSessionEvents };
});

const port = Number(process.env.WORKER_PORT ?? 8090);
const host = process.env.WORKER_HOST ?? "0.0.0.0";

app
  .listen({ port, host })
  .then(() => app.log.info({ port }, "vibent-worker started"))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
