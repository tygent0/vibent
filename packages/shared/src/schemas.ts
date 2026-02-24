import { z } from "zod";

export const runStatusSchema = z.enum(["Draft", "Verified", "Published"]);

export const runSchema = z.object({
  id: z.string(),
  goal: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  patchPointer: z.string(),
  evalPointers: z.array(z.string()).default([]),
  reviewPointers: z.array(z.string()).default([]),
  releasePointers: z.array(z.string()).default([]),
  transcriptPointer: z.string().nullable().default(null),
  reproducibility: z.enum(["replayable-locally", "server-only"]),
  status: runStatusSchema,
  changedFiles: z.array(z.string()).default([]),
  scopeHints: z.array(z.string()).optional(),
  sessionId: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Run = z.infer<typeof runSchema>;

export const createRunRequestSchema = z.object({
  goal: z.string().min(3),
  baseRef: z.string().default("HEAD")
});

export const evalResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  commands: z.array(z.string()),
  passed: z.boolean(),
  summary: z.string(),
  artifactPointer: z.string(),
  environmentFingerprint: z.string().optional(),
  createdAt: z.string()
});

export type EvalResult = z.infer<typeof evalResultSchema>;

export const providerKindSchema = z.enum(["stub", "openai-compatible", "anthropic-compatible"]);

export const providerConfigSchema = z.object({
  kind: providerKindSchema.default("stub"),
  model: z.string().default("local-stub"),
  apiBaseUrl: z.string().url().optional(),
  maxAttempts: z.number().int().positive().max(10).default(3),
  maxPatchChars: z.number().int().positive().max(1_000_000).default(200_000),
  timeoutMs: z.number().int().positive().max(10 * 60 * 1000).default(120_000)
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const reviewFindingSeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);

export const reviewFindingCategorySchema = z.enum(["lint", "test", "security", "dependency", "policy", "release"]);

export const reviewFindingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  category: reviewFindingCategorySchema,
  severity: reviewFindingSeveritySchema,
  title: z.string(),
  detail: z.string(),
  command: z.string().nullable().default(null),
  artifactPointer: z.string().nullable().default(null),
  createdAt: z.string()
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewResultSchema = z.object({
  id: z.string(),
  runId: z.string(),
  passed: z.boolean(),
  summary: z.string(),
  findings: z.array(reviewFindingSchema).default([]),
  commands: z.array(z.string()).default([]),
  createdAt: z.string()
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const releaseStatusSchema = z.enum(["created", "deploying", "canary", "stable", "rolled_back", "failed"]);

export const releaseSchema = z.object({
  id: z.string(),
  runId: z.string(),
  bundleId: z.string().nullable().default(null),
  environment: z.string().default("dev"),
  status: releaseStatusSchema,
  trafficPercent: z.number().int().min(0).max(100).default(0),
  version: z.string(),
  notes: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Release = z.infer<typeof releaseSchema>;

export const productionSignalSeveritySchema = z.enum(["info", "warning", "critical"]);
export const productionSignalTypeSchema = z.enum([
  "error_rate",
  "latency",
  "availability",
  "rollback",
  "cost",
  "throughput"
]);

export const productionSignalSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  source: z.string().default("manual"),
  type: productionSignalTypeSchema,
  severity: productionSignalSeveritySchema,
  summary: z.string(),
  metricValue: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  createdAt: z.string()
});

export type ProductionSignal = z.infer<typeof productionSignalSchema>;

export const publishModeSchema = z.enum(["pr", "direct"]);

export const publishRequestSchema = z.object({
  runId: z.string(),
  mode: publishModeSchema.default("pr"),
  prUrl: z.string().optional(),
  prNumber: z.number().int().positive().optional()
});

export const statusSchema = z.object({
  capabilities: z.array(z.string()),
  repoConnected: z.boolean(),
  authState: z.enum(["connected", "disconnected"])
});

export type VibentStatus = z.infer<typeof statusSchema>;

export const sessionStatusSchema = z.enum(["active", "archived"]);

export const sessionSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  startedAt: z.string(),
  lastActiveAt: z.string(),
  createdBy: z.string(),
  branchRef: z.string().nullable().default(null),
  title: z.string(),
  status: sessionStatusSchema,
  pinned: z.boolean().default(false),
  summary: z.string().default(""),
  linkedRuns: z.array(z.string()).default([])
});

export type Session = z.infer<typeof sessionSchema>;

export const sessionEventTypeSchema = z.enum([
  "prompt",
  "file_read",
  "file_write",
  "search",
  "command",
  "test_run",
  "build",
  "error",
  "decision",
  "note",
  "link"
]);

export const sessionEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  runId: z.string().nullable().default(null),
  ts: z.string(),
  type: sessionEventTypeSchema,
  payload: z.record(z.unknown()),
  artifactPointer: z.string().nullable().default(null)
});

export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const highlightTypeSchema = z.enum([
  "goal",
  "constraint",
  "finding",
  "failure",
  "fix",
  "regression",
  "performance_delta",
  "next_step",
  "open_question"
]);

export const highlightSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  runId: z.string().nullable().default(null),
  type: highlightTypeSchema,
  text: z.string(),
  pointers: z
    .object({
      runId: z.string().optional(),
      files: z.array(z.string()).default([]),
      evalIds: z.array(z.string()).default([]),
      artifacts: z.array(z.string()).default([])
    })
    .default({ files: [], evalIds: [], artifacts: [] }),
  confidence: z.number().min(0).max(1).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type Highlight = z.infer<typeof highlightSchema>;

export const knownFailureSchema = z.object({
  text: z.string(),
  runId: z.string().optional(),
  links: z.array(z.string()).default([])
});

export const memorySnapshotSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  touchedFiles: z.array(z.string()).default([]),
  touchedSymbols: z.array(z.string()).default([]),
  keyDecisions: z.array(z.string()).default([]),
  knownFailures: z.array(knownFailureSchema).default([]),
  lastKnownGood: z.string().nullable().default(null),
  environmentFingerprint: z.string(),
  testStatusSummary: z.string(),
  createdAt: z.string()
});

export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;

export const resumePlanSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  tasks: z.array(z.string()).default([]),
  suggestedCommands: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type ResumePlan = z.infer<typeof resumePlanSchema>;

export const sessionStartRequestSchema = z.object({
  title: z.string().min(1).optional(),
  from: z.string().optional(),
  branchRef: z.string().optional(),
  createdBy: z.string().optional(),
  repoId: z.string().optional()
});

export const sessionContinueRequestSchema = z.object({
  sessionId: z.string()
});

export const sessionNoteRequestSchema = z.object({
  sessionId: z.string().optional(),
  text: z.string().min(1)
});

export const memoryQueryRequestSchema = z.object({
  sessionId: z.string().optional(),
  query: z.string().optional(),
  files: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  limit: z.number().int().positive().max(25).default(5)
});

export const resumePlanRequestSchema = z.object({
  sessionId: z.string().optional()
});

export const reviewRunRequestSchema = z.object({
  runId: z.string(),
  commands: z.array(z.string()).default([])
});

export const releaseCreateRequestSchema = z.object({
  runId: z.string(),
  environment: z.string().default("dev"),
  trafficPercent: z.number().int().min(0).max(100).default(10),
  notes: z.string().default("")
});

export const releasePromoteRequestSchema = z.object({
  releaseId: z.string(),
  trafficPercent: z.number().int().min(0).max(100).default(100)
});

export const releaseRollbackRequestSchema = z.object({
  releaseId: z.string(),
  reason: z.string().default("manual rollback")
});

export const signalIngestRequestSchema = z.object({
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  source: z.string().default("manual"),
  type: productionSignalTypeSchema,
  severity: productionSignalSeveritySchema.default("warning"),
  summary: z.string().min(3),
  metricValue: z.number().optional(),
  unit: z.string().optional()
});
