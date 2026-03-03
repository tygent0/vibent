import fs from "node:fs";
import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import {
  createRunRequestSchema,
  EvalResult,
  evalResultSchema,
  highlightSchema,
  memoryQueryRequestSchema,
  memorySnapshotSchema,
  productionSignalSchema,
  publishRequestSchema,
  releaseCreateRequestSchema,
  releasePromoteRequestSchema,
  releaseRollbackRequestSchema,
  releaseSchema,
  reviewFindingSchema,
  reviewRunRequestSchema,
  reviewResultSchema,
  resumePlanRequestSchema,
  resumePlanSchema,
  runSchema,
  signalIngestRequestSchema,
  sessionContinueRequestSchema,
  sessionEventSchema,
  sessionNoteRequestSchema,
  sessionSchema,
  sessionStartRequestSchema,
  statusSchema
} from "@vibent/shared";
import { loadConfig } from "./config.js";
import { createId } from "./lib/ids.js";
import {
  AuthSessionPayload,
  OAuthStatePayload,
  clearCookie,
  createOAuthState,
  decodeSignedObject,
  encodeSignedObject,
  parseCookieHeader,
  serializeCookie
} from "./lib/auth.js";
import { publishEvidence } from "./lib/github.js";
import { createMockGithubClient } from "./lib/mockGithub.js";
import { hashRunManifest } from "./lib/runManifest.js";
import { FileStore } from "./lib/store.js";
import { suggestCommands } from "./lib/testPlanner.js";
import { validateGithubSignature } from "./lib/webhook.js";

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface GithubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  owner: {
    login: string;
  };
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  };
}

const OAUTH_STATE_COOKIE = "vibent_oauth_state";
const SESSION_COOKIE = "vibent_session";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function resolveCallbackUrl(input: string | undefined, webUrl: string): string | null {
  const fallback = new URL("/signin/callback", webUrl).toString();
  const raw = input ?? fallback;
  try {
    const parsed = new URL(raw);
    const allowed = new URL(webUrl);
    if (parsed.origin !== allowed.origin) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveApiBaseUrlFromRequest(request: { headers: Record<string, unknown> }): string | null {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = request.headers.host;

  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const hostRaw = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const fallbackHost = Array.isArray(host) ? host[0] : host;
  const resolvedHost = String(hostRaw ?? fallbackHost ?? "").trim();
  const resolvedProto = String(proto ?? "https").trim();
  if (!resolvedHost) return null;
  return `${resolvedProto}://${resolvedHost}`;
}

function resolveCookiePolicy(apiBaseUrl: string | null, webUrl: string): { sameSite: "Lax" | "None"; secure: boolean } {
  if (!apiBaseUrl) {
    return { sameSite: "Lax", secure: false };
  }
  try {
    const api = new URL(apiBaseUrl);
    const web = new URL(webUrl);
    const crossOrigin = api.origin !== web.origin;
    const secure = api.protocol === "https:";
    if (crossOrigin && secure) {
      return { sameSite: "None", secure: true };
    }
  } catch {
    // Fall through to local-safe defaults.
  }
  return { sameSite: "Lax", secure: false };
}

function withOAuthResult(returnTo: string, params: Record<string, string>): string {
  const next = new URL(returnTo);
  for (const [key, value] of Object.entries(params)) {
    next.searchParams.set(key, value);
  }
  return next.toString();
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .filter((token) => token.length >= 2);
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const lookup = new Set(left);
  let hits = 0;
  for (const token of right) {
    if (lookup.has(token)) hits += 1;
  }
  return hits / Math.max(1, Math.min(left.length, right.length));
}

function recencyScore(isoTs: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(isoTs).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays);
}

function extractTopErrorLine(summary: string): string {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = lines.find((line) => /(error|failed|exception|ERR_)/i.test(line));
  return (errorLine ?? lines[0] ?? "verification failed").slice(0, 200);
}

function changedSinceLastKnownGood(store: FileStore, sessionId: string): string[] {
  const snapshot = store.latestSnapshot(sessionId);
  if (!snapshot?.lastKnownGood) return [];
  const runs = store.listRunsForSession(sessionId);
  const files = new Set<string>();
  for (const run of runs) {
    if (run.id === snapshot.lastKnownGood) break;
    const runWithSession = run as typeof run & { changedFiles?: string[] };
    for (const file of runWithSession.changedFiles ?? []) {
      files.add(file);
    }
  }
  return [...files].slice(0, 12);
}

function ensureActiveSession(store: FileStore, goal: string): ReturnType<typeof sessionSchema.parse> {
  const active = store.getActiveSession();
  if (active && active.status === "active") {
    return active;
  }

  const now = new Date().toISOString();
  const session = sessionSchema.parse({
    id: createId("sess"),
    repoId: "local-repo",
    startedAt: now,
    lastActiveAt: now,
    createdBy: "local-user",
    branchRef: null,
    title: goal,
    status: "active",
    pinned: false,
    summary: "",
    linkedRuns: []
  });
  store.upsertSession(session);
  store.setActiveSession(session.id);
  return session;
}

function buildResumePlan(store: FileStore, sessionId: string): ReturnType<typeof resumePlanSchema.parse> {
  const latestRun = store.listRunsForSession(sessionId)[0];
  const latestFailure = store
    .listHighlights(sessionId)
    .find((highlight) => highlight.type === "failure" || highlight.type === "regression");
  const latestSignal = store.listProductionSignals({ sessionId, limit: 5 })[0];
  const latestRelease = latestRun ? store.listReleases({ runId: latestRun.id })[0] : undefined;

  const tasks: string[] = [];
  const suggestedCommands: string[] = [];
  const risks: string[] = [];

  if (latestSignal?.severity === "critical") {
    tasks.push(`Investigate critical production signal: ${latestSignal.summary}`);
    if (latestRelease && latestRelease.status !== "rolled_back") {
      suggestedCommands.push(`vibent release rollback ${latestRelease.id} --reason "critical signal"`);
    }
    risks.push("Production health degraded.");
  } else if (latestFailure) {
    tasks.push("Fix the latest failing checks before publishing.");
    if (latestFailure.pointers.runId) {
      suggestedCommands.push(`vibent verify ${latestFailure.pointers.runId}`);
      suggestedCommands.push(`vibent replay ${latestFailure.pointers.runId}`);
    }
    risks.push("Recent verification failed.");
  } else if (latestRun) {
    tasks.push("Review latest run and publish when ready.");
    suggestedCommands.push(`vibent verify ${latestRun.id}`);
    suggestedCommands.push(`vibent replay ${latestRun.id}`);
    if (latestRelease && latestRelease.status === "canary") {
      tasks.push(`Promote or rollback canary release ${latestRelease.id}.`);
      suggestedCommands.push(`vibent release promote ${latestRelease.id} --traffic 100`);
      suggestedCommands.push(`vibent release rollback ${latestRelease.id} --reason "canary regression"`);
    }
  } else {
    tasks.push("Start a run for the next change.");
    suggestedCommands.push('vibent run "describe next change"');
  }

  const now = new Date().toISOString();
  const resume = resumePlanSchema.parse({
    id: createId("resume"),
    sessionId,
    tasks,
    suggestedCommands,
    risks,
    createdAt: now,
    updatedAt: now
  });
  store.upsertResumePlan(resume);
  return resume;
}

function buildSnapshot(
  store: FileStore,
  sessionId: string,
  summary: string
): ReturnType<typeof memorySnapshotSchema.parse> {
  const runs = store.listRunsForSession(sessionId);
  const fileCount = new Map<string, number>();
  for (const run of runs.slice(0, 20)) {
    const runWithFiles = run as typeof run & { changedFiles?: string[] };
    for (const file of runWithFiles.changedFiles ?? []) {
      fileCount.set(file, (fileCount.get(file) ?? 0) + 1);
    }
  }
  const touchedFiles = [...fileCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([file]) => file);

  let lastKnownGood: string | null = null;
  for (const run of runs) {
    const evals = store.listEvalsForRun(run.id);
    if (evals.length > 0 && evals.every((evalResult) => evalResult.passed)) {
      lastKnownGood = run.id;
      break;
    }
  }

  const knownFailures = store
    .listHighlights(sessionId)
    .filter((highlight) => highlight.type === "failure")
    .slice(0, 5)
    .map((highlight) => ({
      text: highlight.text,
      runId: highlight.runId ?? undefined,
      links: highlight.pointers.artifacts
    }));

  const snapshot = memorySnapshotSchema.parse({
    id: createId("snap"),
    sessionId,
    touchedFiles,
    touchedSymbols: [],
    keyDecisions: store
      .listSessionEvents(sessionId)
      .filter((event) => event.type === "decision")
      .slice(0, 5)
      .map((event) => String(event.payload.text ?? event.payload.rationale_short ?? "")),
    knownFailures,
    lastKnownGood,
    environmentFingerprint: hashRunManifest({
      goal: process.env.NODE_ENV ?? "dev",
      baseRef: process.version,
      baseSha: process.platform,
      patchPointer: process.cwd(),
      reproducibility: "replayable-locally"
    }),
    testStatusSummary: summary,
    createdAt: new Date().toISOString()
  });

  store.upsertSnapshot(snapshot);
  return snapshot;
}

function createHighlight(
  store: FileStore,
  input: {
    sessionId: string;
    runId?: string | null;
    type: "goal" | "failure" | "fix" | "next_step" | "finding" | "regression";
    text: string;
    pointers?: { runId?: string; files?: string[]; evalIds?: string[]; artifacts?: string[] };
    confidence?: number;
  }
): ReturnType<typeof highlightSchema.parse> {
  const now = new Date().toISOString();
  const highlight = highlightSchema.parse({
    id: createId("hl"),
    sessionId: input.sessionId,
    runId: input.runId ?? null,
    type: input.type,
    text: input.text,
    pointers: {
      runId: input.pointers?.runId,
      files: input.pointers?.files ?? [],
      evalIds: input.pointers?.evalIds ?? [],
      artifacts: input.pointers?.artifacts ?? []
    },
    confidence: input.confidence ?? null,
    createdAt: now,
    updatedAt: now
  });
  store.upsertHighlight(highlight);
  return highlight;
}

function buildReviewResult(
  store: FileStore,
  run: ReturnType<typeof runSchema.parse>,
  commands: string[]
): ReturnType<typeof reviewResultSchema.parse> {
  const findings = [];
  const now = new Date().toISOString();
  const evals = store.listEvalsForRun(run.id);
  const hasPassingEval = evals.some((evalResult) => evalResult.passed);
  const patch = fs.existsSync(run.patchPointer) ? fs.readFileSync(run.patchPointer, "utf8") : "";

  if (!hasPassingEval) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "policy",
        severity: "high",
        title: "Verification missing or failing",
        detail: "Run does not have a passing evaluation. Execute verify before publish.",
        command: null,
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  if (
    /(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[a-z0-9_\-]{8,}/i.test(patch) ||
    /(ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,}|sk-[a-z0-9]{12,})/i.test(patch)
  ) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "security",
        severity: "critical",
        title: "Potential secret exposure in patch",
        detail: "Detected token-like values in patch content. Rotate and remove before publish.",
        command: null,
        artifactPointer: run.patchPointer,
        createdAt: now
      })
    );
  }

  const runWithFiles = run as typeof run & { changedFiles?: string[] };
  const changedFiles = runWithFiles.changedFiles ?? [];
  if (changedFiles.some((file) => file === "pnpm-lock.yaml" || file.endsWith("package.json"))) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "dependency",
        severity: "medium",
        title: "Dependency manifests changed",
        detail: "Dependency files changed; run targeted regression tests.",
        command: "pnpm audit --prod",
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  if (changedFiles.some((file) => file.startsWith("infra/") || file.endsWith(".tf"))) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "release",
        severity: "medium",
        title: "Infrastructure changes detected",
        detail: "Infra updates require staged rollout and rollback readiness.",
        command: "terraform -chdir=infra/terraform fmt -check",
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  if (commands.length > 0) {
    findings.push(
      reviewFindingSchema.parse({
        id: createId("finding"),
        runId: run.id,
        category: "lint",
        severity: "info",
        title: "Review commands requested",
        detail: `Requested commands: ${commands.join(" | ")}`,
        command: commands.join(" && "),
        artifactPointer: null,
        createdAt: now
      })
    );
  }

  const blocking = findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  return reviewResultSchema.parse({
    id: createId("review"),
    runId: run.id,
    passed: blocking.length === 0,
    summary:
      blocking.length === 0
        ? `Review passed with ${findings.length} findings.`
        : `Review failed with ${blocking.length} blocking findings.`,
    findings,
    commands,
    createdAt: now
  });
}

export function createApp(): FastifyInstance {
  const config = loadConfig();
  const app = Fastify({ logger: true, requestIdHeader: "x-request-id" });
  const store = new FileStore(config.dataDir);
  const oauthConfigured = config.githubClientId.length > 0 && config.githubClientSecret.length > 0;

  fs.mkdirSync(config.artifactsDir, { recursive: true });

  app.register(cors, { origin: true, credentials: true });

  app.get("/health", async () => ({ status: "ok", service: "vibent-api" }));

  app.get("/v1/openapi/api", async (_request, reply) => {
    const spec = fs.readFileSync(path.join(process.cwd(), "packages/shared/openapi/api.yaml"), "utf8");
    reply.type("text/yaml");
    return spec;
  });

  app.get("/v1/openapi/agent", async (_request, reply) => {
    const spec = fs.readFileSync(path.join(process.cwd(), "packages/shared/openapi/agent.yaml"), "utf8");
    reply.type("text/yaml");
    return spec;
  });

  app.get("/v1/status", async () => {
    return statusSchema.parse({
      capabilities: [
        "run",
        "verify",
        "review",
        "publish",
        "release",
        "signals",
        "blame",
        "replay",
        "agent-mode",
        "session",
        "memory",
        "resume"
      ],
      repoConnected: store.isRepoConnected(),
      authState: store.isRepoConnected() ? "connected" : "disconnected"
    });
  });

  app.get("/v1/auth/session", async (request, reply) => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const rawSession = cookies[SESSION_COOKIE];
    const session = decodeSignedObject<AuthSessionPayload>(rawSession, config.sessionSecret);
    const expiresAt = session ? new Date(session.expiresAt).getTime() : 0;
    const validSession = session && Number.isFinite(expiresAt) && expiresAt > Date.now() ? session : null;
    const cookiePolicy = resolveCookiePolicy(resolveApiBaseUrlFromRequest(request), config.webUrl);

    if (!validSession && rawSession) {
      reply.header("set-cookie", clearCookie(SESSION_COOKIE, cookiePolicy));
    }

    return {
      connected: store.isRepoConnected() || Boolean(validSession),
      user: validSession?.user ?? null,
      selectedRepos: store.listSelectedRepos()
    };
  });

  app.get("/v1/auth/github/start", async (request, reply) => {
    const query = request.query as { returnTo?: string };
    const returnTo = resolveCallbackUrl(query.returnTo, config.webUrl);
    if (!returnTo) {
      reply.code(400);
      return { error: "Invalid returnTo URL. It must match VIBENT_WEB_URL origin." };
    }
    const apiBaseUrl = resolveApiBaseUrlFromRequest(request);
    if (!apiBaseUrl) {
      reply.code(400);
      return { error: "Could not resolve API host for OAuth callback." };
    }
    const cookiePolicy = resolveCookiePolicy(apiBaseUrl, config.webUrl);
    const redirectUri = `${apiBaseUrl}/v1/auth/github/callback`;

    if (!oauthConfigured) {
      const redirect = new URL(returnTo);
      redirect.searchParams.set("error", "oauth_not_configured");
      redirect.searchParams.set(
        "error_description",
        "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."
      );
      reply.redirect(redirect.toString());
      return undefined;
    }

    const state = createOAuthState();
    const oauthStateCookie = encodeSignedObject<OAuthStatePayload>(
      { state, returnTo, oauthRedirectUri: redirectUri, createdAt: new Date().toISOString() },
      config.sessionSecret
    );
    reply.header(
      "set-cookie",
      serializeCookie(OAUTH_STATE_COOKIE, oauthStateCookie, {
        path: "/",
        httpOnly: true,
        sameSite: cookiePolicy.sameSite,
        secure: cookiePolicy.secure,
        maxAge: OAUTH_STATE_MAX_AGE_SECONDS
      })
    );

    const params = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: redirectUri,
      scope: config.oauthScopes,
      state,
      allow_signup: "true"
    });
    reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    return undefined;
  });

  app.get("/v1/auth/github/callback", async (request, reply) => {
    const fallbackReturnTo = new URL("/signin/callback", config.webUrl).toString();
    if (!oauthConfigured) {
      reply.redirect(
        withOAuthResult(fallbackReturnTo, {
          status: "error",
          error: "oauth_not_configured",
          error_description: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET."
        })
      );
      return undefined;
    }

    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state) {
      reply.redirect(
        withOAuthResult(fallbackReturnTo, {
          status: "error",
          error: "missing_code_or_state",
          error_description: "Missing code or state in callback query."
        })
      );
      return undefined;
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const stateCookie = decodeSignedObject<
      OAuthStatePayload & { redirectUri?: string }
    >(cookies[OAUTH_STATE_COOKIE], config.sessionSecret);
    const returnTo = resolveCallbackUrl(stateCookie?.returnTo ?? stateCookie?.redirectUri, config.webUrl) ?? fallbackReturnTo;
    if (!stateCookie) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "missing_oauth_state",
          error_description: "Missing or invalid OAuth state cookie."
        })
      );
      return undefined;
    }
    if (stateCookie.state !== query.state) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "oauth_state_mismatch",
          error_description: "OAuth state mismatch."
        })
      );
      return undefined;
    }
    const ageMs = Date.now() - new Date(stateCookie.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > OAUTH_STATE_MAX_AGE_SECONDS * 1000) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "oauth_state_expired",
          error_description: "OAuth state expired. Start sign-in again."
        })
      );
      return undefined;
    }

    const apiBaseUrl = resolveApiBaseUrlFromRequest(request);
    const cookiePolicy = resolveCookiePolicy(apiBaseUrl, config.webUrl);
    const oauthRedirectUri = stateCookie.oauthRedirectUri ?? (apiBaseUrl ? `${apiBaseUrl}/v1/auth/github/callback` : "");
    if (!oauthRedirectUri) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "oauth_callback_resolution_failed",
          error_description: "Could not resolve OAuth callback URL for token exchange."
        })
      );
      return undefined;
    }

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "vibent-api"
      },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code: query.code,
        redirect_uri: oauthRedirectUri,
        state: query.state
      })
    });
    if (!tokenRes.ok) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "oauth_exchange_failed",
          error_description: "Failed to exchange GitHub OAuth code."
        })
      );
      return undefined;
    }

    const token = (await tokenRes.json()) as GithubTokenResponse;
    if (!token.access_token || token.error) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: token.error ?? "oauth_exchange_failed",
          error_description: token.error_description ?? token.error ?? "GitHub OAuth exchange failed."
        })
      );
      return undefined;
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token.access_token}`,
        "user-agent": "vibent-api",
        "x-github-api-version": "2022-11-28"
      }
    });
    if (!userRes.ok) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "oauth_profile_load_failed",
          error_description: "Failed to load GitHub user profile."
        })
      );
      return undefined;
    }

    const user = (await userRes.json()) as GithubUserResponse;
    if (!user.id || !user.login) {
      reply.redirect(
        withOAuthResult(returnTo, {
          status: "error",
          error: "oauth_profile_incomplete",
          error_description: "GitHub user profile was incomplete."
        })
      );
      return undefined;
    }

    const now = Date.now();
    const session = encodeSignedObject<AuthSessionPayload>(
      {
        user: {
          id: user.id,
          login: user.login,
          name: user.name ?? null,
          avatarUrl: user.avatar_url ?? null
        },
        connectedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
        githubAccessToken: token.access_token
      },
      config.sessionSecret
    );
    store.setRepoConnection(true);
    reply.header("set-cookie", [
      serializeCookie(SESSION_COOKIE, session, {
        path: "/",
        httpOnly: true,
        sameSite: cookiePolicy.sameSite,
        secure: cookiePolicy.secure,
        maxAge: SESSION_MAX_AGE_SECONDS
      }),
      clearCookie(OAUTH_STATE_COOKIE, cookiePolicy)
    ]);
    reply.redirect(
      withOAuthResult(returnTo, {
        status: "ok",
        login: user.login
      })
    );
    return undefined;
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    store.setRepoConnection(false);
    store.setSelectedRepos([]);
    const cookiePolicy = resolveCookiePolicy(resolveApiBaseUrlFromRequest(request), config.webUrl);
    reply.header("set-cookie", [clearCookie(SESSION_COOKIE, cookiePolicy), clearCookie(OAUTH_STATE_COOKIE, cookiePolicy)]);
    return { ok: true };
  });

  app.get("/v1/auth/github/repos", async (request, reply) => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const rawSession = cookies[SESSION_COOKIE];
    const session = decodeSignedObject<AuthSessionPayload>(rawSession, config.sessionSecret);
    const expiresAt = session ? new Date(session.expiresAt).getTime() : 0;
    const validSession = session && Number.isFinite(expiresAt) && expiresAt > Date.now() ? session : null;
    const cookiePolicy = resolveCookiePolicy(resolveApiBaseUrlFromRequest(request), config.webUrl);

    if (!validSession) {
      if (rawSession) {
        reply.header("set-cookie", clearCookie(SESSION_COOKIE, cookiePolicy));
      }
      reply.code(401);
      return { error: "Not signed in." };
    }

    if (!validSession.githubAccessToken) {
      reply.code(401);
      return { error: "Session is missing GitHub access. Sign in again." };
    }

    const selectedRepos = new Set(store.listSelectedRepos());
    const repos: Array<{
      id: number;
      name: string;
      fullName: string;
      private: boolean;
      owner: string;
      defaultBranch: string;
      htmlUrl: string;
      selected: boolean;
      permissions: {
        admin: boolean;
        push: boolean;
        pull: boolean;
      };
    }> = [];

    for (let page = 1; page <= 10; page += 1) {
      const repoRes = await fetch(
        `https://api.github.com/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=full_name`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${validSession.githubAccessToken}`,
            "user-agent": "vibent-api",
            "x-github-api-version": "2022-11-28"
          }
        }
      );

      if (!repoRes.ok) {
        reply.code(502);
        return { error: "Failed to load repositories from GitHub." };
      }

      const batch = (await repoRes.json()) as GithubRepoResponse[];
      repos.push(
        ...batch.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          owner: repo.owner.login,
          defaultBranch: repo.default_branch,
          htmlUrl: repo.html_url,
          selected: selectedRepos.has(repo.full_name),
          permissions: {
            admin: Boolean(repo.permissions?.admin),
            push: Boolean(repo.permissions?.push),
            pull: Boolean(repo.permissions?.pull ?? true)
          }
        }))
      );

      if (batch.length < 100) {
        break;
      }
    }

    return { repos };
  });

  app.post("/v1/auth/github/repos/select", async (request, reply) => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const rawSession = cookies[SESSION_COOKIE];
    const session = decodeSignedObject<AuthSessionPayload>(rawSession, config.sessionSecret);
    const expiresAt = session ? new Date(session.expiresAt).getTime() : 0;
    const validSession = session && Number.isFinite(expiresAt) && expiresAt > Date.now() ? session : null;
    if (!validSession) {
      reply.code(401);
      return { error: "Not signed in." };
    }

    const body = request.body as { repos?: string[] };
    const repos = [...new Set((body.repos ?? []).map((repo) => repo.trim()).filter(Boolean))];
    if (repos.length === 0) {
      reply.code(400);
      return { error: "Select at least one repository." };
    }
    if (repos.length > 100) {
      reply.code(400);
      return { error: "Too many repositories selected. Limit is 100." };
    }

    const selectedRepos = store.setSelectedRepos(repos);
    return { ok: true, selectedRepos };
  });

  app.post("/v1/mock/connect", async (request) => {
    const body = request.body as { connected?: boolean };
    store.setRepoConnection(body.connected ?? true);
    if ((body.connected ?? true) === false) {
      store.setSelectedRepos([]);
    }
    return { ok: true, connected: store.isRepoConnected() };
  });

  app.post("/v1/runs", async (request, reply) => {
    const parsed = createRunRequestSchema.parse(request.body ?? {});
    const id = createId("run");
    const now = new Date().toISOString();
    const patchPointer = path.join(config.artifactsDir, `${id}.patch`);
    fs.writeFileSync(
      patchPointer,
      "# Stub patch produced by local provider\n# Replace with real diff on patch/propose\n"
    );

    const session = ensureActiveSession(store, parsed.goal);

    const run = runSchema.parse({
      id,
      goal: parsed.goal,
      baseRef: parsed.baseRef,
      baseSha: "local-head",
      patchPointer,
      evalPointers: [],
      transcriptPointer: null,
      reproducibility: "replayable-locally",
      status: "Draft",
      sessionId: session.id,
      createdAt: now,
      updatedAt: now
    });

    store.upsertRun(run);
    store.linkRunToSession(run.id, session.id);

    const event = sessionEventSchema.parse({
      id: createId("evt"),
      sessionId: session.id,
      runId: run.id,
      ts: now,
      type: "prompt",
      payload: { text: parsed.goal },
      artifactPointer: null
    });
    store.appendSessionEvent(event);

    createHighlight(store, {
      sessionId: session.id,
      runId: run.id,
      type: "goal",
      text: `Goal: ${run.goal}`,
      pointers: { runId: run.id, files: [] }
    });
    buildSnapshot(store, session.id, "Draft run recorded");
    buildResumePlan(store, session.id);

    const manifestHash = hashRunManifest({
      goal: run.goal,
      baseRef: run.baseRef,
      baseSha: run.baseSha,
      patchPointer: run.patchPointer,
      reproducibility: run.reproducibility
    });

    reply.code(201);
    return { run, manifestHash, sessionId: session.id };
  });

  app.get("/v1/runs", async () => {
    return { runs: store.listRuns() };
  });

  app.get("/v1/runs/:runId", async (request, reply) => {
    const params = request.params as { runId: string };
    const run = store.getRun(params.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }

    return {
      run,
      evals: store.listEvalsForRun(run.id)
    };
  });

  app.post("/v1/evals/plan", async (request) => {
    const body = request.body as { runId: string; changedFiles?: string[] };
    const run = store.getRun(body.runId);
    if (!run) {
      return { error: "Run not found" };
    }
    const commands = suggestCommands(body.changedFiles ?? [], process.cwd());
    return {
      planId: createId("plan"),
      runId: run.id,
      commands
    };
  });

  app.post("/v1/evals", async (request, reply) => {
    const body = request.body as {
      runId: string;
      commands: string[];
      passed: boolean;
      summary: string;
      artifactPointer: string;
    };

    const evalResult = evalResultSchema.parse({
      id: createId("eval"),
      runId: body.runId,
      commands: body.commands,
      passed: body.passed,
      summary: body.summary,
      artifactPointer: body.artifactPointer,
      createdAt: new Date().toISOString()
    });

    store.upsertEval(evalResult);

    const run = store.getRun(body.runId) as (typeof runSchema._type & { sessionId?: string | null }) | undefined;
    if (!run || !run.sessionId) {
      return { eval: evalResult };
    }

    const session = store.getSession(run.sessionId);
    if (!session) {
      return { eval: evalResult };
    }

    if (!body.passed) {
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "failure",
        text: `Failed: ${body.commands.join(", ")}. ${extractTopErrorLine(body.summary)}`,
        pointers: {
          runId: run.id,
          files: (run as typeof run & { changedFiles?: string[] }).changedFiles ?? [],
          evalIds: [evalResult.id],
          artifacts: [body.artifactPointer]
        },
        confidence: 0.9
      });
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text: "Next: inspect failing output and rerun affected suite.",
        pointers: {
          runId: run.id,
          evalIds: [evalResult.id],
          artifacts: [body.artifactPointer]
        }
      });
    } else {
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "fix",
        text: `Verified: ${body.commands.join(", ")} passed.`,
        pointers: {
          runId: run.id,
          files: (run as typeof run & { changedFiles?: string[] }).changedFiles ?? [],
          evalIds: [evalResult.id],
          artifacts: [body.artifactPointer]
        },
        confidence: 0.95
      });
      createHighlight(store, {
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text: "Next: review and publish evidence when ready.",
        pointers: {
          runId: run.id,
          evalIds: [evalResult.id]
        }
      });
    }

    buildSnapshot(store, session.id, body.summary);
    buildResumePlan(store, session.id);

    return { eval: evalResult };
  });

  app.post("/v1/review/run", async (request, reply) => {
    const body = reviewRunRequestSchema.parse(request.body ?? {});
    const run = store.getRun(body.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = buildReviewResult(store, run, body.commands);
    store.upsertReview(review);

    const runWithSession = run as typeof run & { sessionId?: string | null; changedFiles?: string[] };
    if (runWithSession.sessionId) {
      const session = store.getSession(runWithSession.sessionId);
      if (session) {
        createHighlight(store, {
          sessionId: session.id,
          runId: run.id,
          type: review.passed ? "fix" : "failure",
          text: review.passed ? `Review passed for ${run.id}.` : `Review blocked for ${run.id}.`,
          pointers: {
            runId: run.id,
            files: runWithSession.changedFiles ?? []
          },
          confidence: review.passed ? 0.9 : 0.95
        });
        if (!review.passed) {
          createHighlight(store, {
            sessionId: session.id,
            runId: run.id,
            type: "next_step",
            text: "Next: resolve blocking review findings and rerun `vibent review`.",
            pointers: { runId: run.id, files: runWithSession.changedFiles ?? [] }
          });
        }
        buildSnapshot(store, session.id, review.summary);
        buildResumePlan(store, session.id);
      }
    }

    return { review };
  });

  app.get("/v1/reviews/:runId", async (request, reply) => {
    const params = request.params as { runId: string };
    const run = store.getRun(params.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    return { reviews: store.listReviewsForRun(run.id) };
  });

  app.post("/v1/releases", async (request, reply) => {
    const body = releaseCreateRequestSchema.parse(request.body ?? {});
    const run = store.getRun(body.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = store.latestReviewForRun(run.id);
    if (!review || !review.passed) {
      reply.code(400);
      return { error: "Release requires passing review." };
    }

    const now = new Date().toISOString();
    const release = releaseSchema.parse({
      id: createId("rel"),
      runId: run.id,
      bundleId: null,
      environment: body.environment,
      status: body.trafficPercent >= 100 ? "stable" : "canary",
      trafficPercent: body.trafficPercent,
      version: `${now.slice(0, 10)}-${run.id.slice(-6)}`,
      notes: body.notes,
      createdAt: now,
      updatedAt: now
    });
    store.upsertRelease(release);
    reply.code(201);
    return { release };
  });

  app.get("/v1/releases", async (request) => {
    const query = request.query as { runId?: string };
    return { releases: store.listReleases({ runId: query.runId }) };
  });

  app.post("/v1/releases/promote", async (request, reply) => {
    const body = releasePromoteRequestSchema.parse(request.body ?? {});
    const release = store.getRelease(body.releaseId);
    if (!release) {
      reply.code(404);
      return { error: "Release not found" };
    }
    release.trafficPercent = body.trafficPercent;
    release.status = body.trafficPercent >= 100 ? "stable" : "canary";
    release.updatedAt = new Date().toISOString();
    store.upsertRelease(releaseSchema.parse(release));
    return { release };
  });

  app.post("/v1/releases/rollback", async (request, reply) => {
    const body = releaseRollbackRequestSchema.parse(request.body ?? {});
    const release = store.getRelease(body.releaseId);
    if (!release) {
      reply.code(404);
      return { error: "Release not found" };
    }
    release.status = "rolled_back";
    release.trafficPercent = 0;
    release.notes = release.notes ? `${release.notes}\nRollback: ${body.reason}` : `Rollback: ${body.reason}`;
    release.updatedAt = new Date().toISOString();
    store.upsertRelease(releaseSchema.parse(release));
    return { release };
  });

  app.post("/v1/signals", async (request, reply) => {
    const body = signalIngestRequestSchema.parse(request.body ?? {});
    const run = body.runId ? (store.getRun(body.runId) as (typeof runSchema._type & { sessionId?: string | null }) | undefined) : undefined;
    const runSessionId = run?.sessionId ?? undefined;
    const session =
      (body.sessionId ? store.getSession(body.sessionId) : undefined) ??
      (runSessionId ? store.getSession(runSessionId) : undefined) ??
      store.getActiveSession();

    const signal = productionSignalSchema.parse({
      id: createId("sig"),
      sessionId: session?.id ?? null,
      runId: body.runId ?? null,
      source: body.source,
      type: body.type,
      severity: body.severity,
      summary: body.summary,
      metricValue: body.metricValue ?? null,
      unit: body.unit ?? null,
      createdAt: new Date().toISOString()
    });
    store.appendProductionSignal(signal);

    if (session) {
      createHighlight(store, {
        sessionId: session.id,
        runId: signal.runId ?? null,
        type: signal.severity === "critical" ? "regression" : "finding",
        text: `Signal ${signal.type}: ${signal.summary}`,
        confidence: signal.severity === "critical" ? 0.95 : 0.8
      });
      buildSnapshot(store, session.id, `Signal ${signal.type} ${signal.severity}`);
      buildResumePlan(store, session.id);
    }

    reply.code(201);
    return { signal };
  });

  app.get("/v1/signals/session/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const session = store.getSession(params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    return { signals: store.listProductionSignals({ sessionId: session.id, limit: 50 }) };
  });

  app.post("/v1/publish", async (request, reply) => {
    const parsed = publishRequestSchema.parse(request.body ?? {});
    if (parsed.mode === "pr" && !store.isRepoConnected()) {
      reply.code(400);
      return { error: "Publishing requires GitHub connection." };
    }

    const run = store.getRun(parsed.runId);
    if (!run) {
      reply.code(404);
      return { error: "Run not found" };
    }
    const review = store.latestReviewForRun(run.id);
    if (!review || !review.passed) {
      reply.code(400);
      return { error: "Publishing requires a passing review." };
    }

    const evals = store.listEvalsForRun(run.id);
    const passed = evals.every((entry) => entry.passed);
    const summary = [
      `Goal: ${run.goal}`,
      `Diff: ${run.patchPointer}`,
      `Tests: ${evals.map((entry) => entry.commands.join(", ")).join(" | ") || "none"}`,
      `Results: ${passed ? "pass" : "fail"}`,
      `Reproduce: vibent replay ${run.id}`
    ].join("\n");

    if (parsed.mode === "pr" && config.mockGithub) {
      const mock = createMockGithubClient();
      await publishEvidence(mock, {
        owner: "local",
        repo: "local",
        prNumber: parsed.prNumber ?? 1,
        headSha: run.baseSha,
        summary,
        passed
      });
    }

    const bundle = store.saveBundle({
      id: createId("bundle"),
      runId: run.id,
      mode: parsed.mode,
      prUrl: parsed.prUrl,
      summary,
      publishedAt: new Date().toISOString()
    });

    return { bundle };
  });

  app.get("/v1/sessions", async () => {
    return { sessions: store.listSessions() };
  });

  app.get("/v1/sessions/:sessionId", async (request, reply) => {
    const params = request.params as { sessionId: string };
    const session = store.getSession(params.sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    return {
      session,
      runs: store.listRunsForSession(session.id),
      highlights: store.listHighlights(session.id).slice(0, 10),
      notes: store.listSessionEvents(session.id).filter((event) => event.type === "note").slice(0, 20),
      signals: store.listProductionSignals({ sessionId: session.id, limit: 20 }),
      releases: store
        .listRunsForSession(session.id)
        .flatMap((run) => store.listReleases({ runId: run.id }))
        .slice(0, 20),
      resume: store.latestResumePlan(session.id) ?? buildResumePlan(store, session.id),
      snapshot: store.latestSnapshot(session.id),
      changedSinceLastKnownGood: changedSinceLastKnownGood(store, session.id)
    };
  });

  app.post("/v1/session/start", async (request) => {
    const body = sessionStartRequestSchema.parse(request.body ?? {});
    const now = new Date().toISOString();
    const session = sessionSchema.parse({
      id: createId("sess"),
      repoId: body.repoId ?? "local-repo",
      startedAt: now,
      lastActiveAt: now,
      createdBy: body.createdBy ?? "local-user",
      branchRef: body.branchRef ?? body.from ?? null,
      title: body.title ?? "Session",
      status: "active",
      pinned: false,
      summary: "",
      linkedRuns: []
    });

    store.upsertSession(session);
    store.setActiveSession(session.id);

    if (body.from) {
      const run = store.getRun(body.from);
      if (run) {
        store.linkRunToSession(run.id, session.id);
      }
    }

    const snapshot = buildSnapshot(store, session.id, "Session started");
    const resume = buildResumePlan(store, session.id);
    return { session, snapshot, resume };
  });

  app.post("/v1/session/continue", async (request, reply) => {
    const body = sessionContinueRequestSchema.parse(request.body ?? {});
    const session = store.getSession(body.sessionId);
    if (!session || session.status !== "active") {
      reply.code(404);
      return { error: "Session not found or archived" };
    }
    session.lastActiveAt = new Date().toISOString();
    store.upsertSession(session);
    store.setActiveSession(session.id);
    const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session.id);
    return { session, resume };
  });

  app.get("/v1/session/status", async (_request, reply) => {
    const session = store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "No active session" };
    }
    return {
      session,
      highlights: store.listHighlights(session.id).slice(0, 10),
      signals: store.listProductionSignals({ sessionId: session.id, limit: 10 }),
      resume: store.latestResumePlan(session.id) ?? buildResumePlan(store, session.id),
      changedSinceLastKnownGood: changedSinceLastKnownGood(store, session.id)
    };
  });

  app.post("/v1/session/note", async (request, reply) => {
    const body = sessionNoteRequestSchema.parse(request.body ?? {});
    const session = body.sessionId ? store.getSession(body.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const note = sessionEventSchema.parse({
      id: createId("evt"),
      sessionId: session.id,
      runId: null,
      ts: new Date().toISOString(),
      type: "note",
      payload: { text: body.text },
      artifactPointer: null
    });
    store.appendSessionEvent(note);
    createHighlight(store, {
      sessionId: session.id,
      type: "finding",
      text: `Note: ${body.text}`
    });
    const snapshot = buildSnapshot(store, session.id, "Note added");
    return { note, snapshot };
  });

  app.post("/v1/session/pin", async (request, reply) => {
    const body = request.body as { sessionId?: string; pinned?: boolean };
    if (!body.sessionId) {
      reply.code(400);
      return { error: "sessionId is required" };
    }
    const session = store.getSession(body.sessionId);
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    session.pinned = body.pinned ?? true;
    session.lastActiveAt = new Date().toISOString();
    store.upsertSession(session);
    return { session };
  });

  app.post("/v1/memory/query", async (request, reply) => {
    const body = memoryQueryRequestSchema.parse(request.body ?? {});
    const session = body.sessionId ? store.getSession(body.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }

    const qTokens = tokenize(body.query ?? "");
    const files = body.files.map((entry) => entry.toLowerCase());
    const highlights = store
      .listHighlights(session.id)
      .map((highlight) => {
        const textTokens = tokenize(highlight.text);
        const fileTokens = highlight.pointers.files.map((entry) => entry.toLowerCase());
        const score =
          recencyScore(highlight.createdAt) * 0.45 +
          overlapScore(qTokens, textTokens) * 0.3 +
          overlapScore(files, fileTokens) * 0.25;
        return { highlight, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, body.limit)
      .map((entry) => entry.highlight);

    const priorRuns = store
      .listRunsForSession(session.id)
      .map((run) => {
        const runFiles = ((run as typeof run & { changedFiles?: string[] }).changedFiles ?? []).map((entry) =>
          entry.toLowerCase()
        );
        const score =
          recencyScore(run.createdAt) * 0.5 +
          overlapScore(qTokens, tokenize(run.goal)) * 0.2 +
          overlapScore(files, runFiles) * 0.3;
        return { run, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, body.limit)
      .map((entry) => entry.run);

    return {
      topHighlights: highlights,
      relevantPriorRuns: priorRuns,
      relevantFailures: highlights.filter((entry) => entry.type === "failure"),
      relevantFixes: highlights.filter((entry) => entry.type === "fix"),
      suggestedNextSteps: store
        .listHighlights(session.id)
        .filter((entry) => entry.type === "next_step")
        .slice(0, body.limit)
        .map((entry) => entry.text)
    };
  });

  app.get("/v1/memory/snapshot", async (request, reply) => {
    const query = request.query as { sessionId?: string };
    const session = query.sessionId ? store.getSession(query.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const snapshot = store.latestSnapshot(session.id);
    if (!snapshot) {
      reply.code(404);
      return { error: "Snapshot not found" };
    }
    return { snapshot };
  });

  app.post("/v1/resume/plan", async (request, reply) => {
    const body = resumePlanRequestSchema.parse(request.body ?? {});
    const session = body.sessionId ? store.getSession(body.sessionId) : store.getActiveSession();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const resume = buildResumePlan(store, session.id);
    return { resume };
  });

  app.post("/v1/webhooks/github", async (request, reply) => {
    const payload = request.body ? JSON.stringify(request.body) : "";
    const signature = request.headers["x-hub-signature-256"] as string | undefined;

    const ok = validateGithubSignature(payload, signature, config.githubWebhookSecret);
    if (!ok) {
      reply.code(401);
      return { error: "Invalid webhook signature" };
    }

    return { accepted: true };
  });

  return app;
}
