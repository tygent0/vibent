import { sha256 } from "./hash.js";
import {
  EvalRecord,
  HighlightRecord,
  HighlightType,
  LocalStore,
  MemorySnapshotRecord,
  ResumePlanRecord,
  RunRecord,
  SessionRecord
} from "./store.js";

interface HighlightDraft {
  type: HighlightType;
  text: string;
  pointers?: Partial<HighlightRecord["pointers"]>;
  confidence?: number | null;
}

export interface MemoryQueryInput {
  query?: string;
  files?: string[];
  symbols?: string[];
  limit?: number;
}

export interface MemoryQueryOutput {
  highlights: HighlightRecord[];
  priorRuns: RunRecord[];
  failures: HighlightRecord[];
  fixes: HighlightRecord[];
  suggestedNextSteps: string[];
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .filter((token) => token.length >= 2);
}

function commandSuiteName(command: string): string {
  const trimmed = command.trim();
  const first = trimmed.split(/\s+/)[0];
  if (first) return first;
  return trimmed.slice(0, 40);
}

export function extractTopErrorLine(logs: string): string | null {
  const lines = logs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const match = lines.find((line) => /(error|failed|exception|ERR_|EADDRINUSE)/i.test(line));
  if (match) return match.slice(0, 200);
  return lines[0].slice(0, 200);
}

function recencyScore(isoTs: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(isoTs).getTime());
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 1 / (1 + ageDays);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  let hits = 0;
  for (const token of b) {
    if (left.has(token)) hits += 1;
  }
  return hits / Math.max(1, Math.min(left.size, b.length));
}

function highlightScore(highlight: HighlightRecord, queryTokens: string[], fileHints: string[]): number {
  const textTokens = tokenize(highlight.text);
  const fileTokens = highlight.pointers.files.map((file) => file.toLowerCase());
  const recency = recencyScore(highlight.createdAt);
  const keyword = overlapScore(queryTokens, textTokens);
  const fileOverlap = overlapScore(fileHints, fileTokens);
  return recency * 0.45 + keyword * 0.35 + fileOverlap * 0.2;
}

function runScore(run: RunRecord, queryTokens: string[], fileHints: string[]): number {
  const goalTokens = tokenize(run.goal);
  const runFiles = run.changedFiles.map((file) => file.toLowerCase());
  const recency = recencyScore(run.createdAt);
  const keyword = overlapScore(queryTokens, goalTokens);
  const fileOverlap = overlapScore(fileHints, runFiles);
  return recency * 0.4 + keyword * 0.25 + fileOverlap * 0.35;
}

export function generateVerifyHighlights(input: {
  run: RunRecord;
  evalResult: EvalRecord;
  redactedLogs: string;
}): HighlightDraft[] {
  const suiteList = input.evalResult.commands.map(commandSuiteName);
  const topError = extractTopErrorLine(input.redactedLogs);
  const suitesText = suiteList.length ? suiteList.join(", ") : "selected checks";

  if (!input.evalResult.passed) {
    const reason = topError ? ` Top error: ${topError}` : "";
    return [
      {
        type: "failure",
        text: `Failed: ${suitesText}.${reason}`,
        pointers: {
          runId: input.run.id,
          files: input.run.changedFiles,
          evalIds: [input.evalResult.id],
          artifacts: [input.evalResult.artifactPointer]
        },
        confidence: 0.9
      },
      {
        type: "next_step",
        text: `Next: inspect failing command output and rerun ${suiteList[0] ?? "verification"} after edits.`,
        pointers: {
          runId: input.run.id,
          files: input.run.changedFiles,
          evalIds: [input.evalResult.id],
          artifacts: [input.evalResult.artifactPointer]
        }
      }
    ];
  }

  return [
    {
      type: "fix",
      text: `Verified: ${suitesText} passed.`,
      pointers: {
        runId: input.run.id,
        files: input.run.changedFiles,
        evalIds: [input.evalResult.id],
        artifacts: [input.evalResult.artifactPointer]
      },
      confidence: 0.95
    },
    {
      type: "next_step",
      text: "Next: review diff and publish evidence if scope is complete.",
      pointers: {
        runId: input.run.id,
        files: input.run.changedFiles,
        evalIds: [input.evalResult.id],
        artifacts: [input.evalResult.artifactPointer]
      }
    }
  ];
}

export function buildSnapshot(
  store: LocalStore,
  session: SessionRecord,
  summary: string,
  environmentSource: Record<string, string | undefined>
): MemorySnapshotRecord {
  const runs = store.listRunsForSession(session.id);
  const topTouched = new Map<string, number>();
  const keyDecisions = store
    .listSessionEvents(session.id, { type: "decision", limit: 5 })
    .map((event) => String(event.payload.text ?? event.payload.rationale_short ?? "").trim())
    .filter(Boolean);

  const failures = store
    .listHighlights(session.id)
    .filter((highlight) => highlight.type === "failure")
    .slice(0, 5)
    .map((highlight) => ({
      text: highlight.text,
      runId: highlight.runId ?? undefined,
      links: highlight.pointers.artifacts
    }));

  let lastKnownGood: string | null = null;
  for (const run of runs) {
    const evals = store.getEvals(run.id);
    if (evals.length > 0 && evals.every((evalResult) => evalResult.passed)) {
      lastKnownGood = run.id;
      break;
    }
  }

  for (const run of runs.slice(0, 20)) {
    for (const file of run.changedFiles) {
      topTouched.set(file, (topTouched.get(file) ?? 0) + 1);
    }
  }

  const touchedFiles = [...topTouched.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([file]) => file);

  const envFingerprint = sha256(
    JSON.stringify({
      node: environmentSource.NODE_VERSION ?? process.version,
      pnpm: environmentSource.PNPM_VERSION ?? "",
      os: environmentSource.OS ?? process.platform
    })
  );

  return store.createSnapshot({
    sessionId: session.id,
    touchedFiles,
    touchedSymbols: [],
    keyDecisions,
    knownFailures: failures,
    lastKnownGood,
    environmentFingerprint: envFingerprint,
    testStatusSummary: summary
  });
}

export function buildResumePlan(store: LocalStore, session: SessionRecord): ResumePlanRecord {
  const latestSnapshot = store.latestSnapshot(session.id);
  const latestHighlights = store.listHighlights(session.id, 10);
  const latestRun = store.listRunsForSession(session.id)[0];
  const latestFailure = latestHighlights.find((highlight) => highlight.type === "failure");
  const latestSignal = store.listSignals({ sessionId: session.id, limit: 5 })[0];
  const latestRelease = latestRun ? store.listReleases(latestRun.id)[0] : null;

  const tasks: string[] = [];
  const commands: string[] = [];
  const risks: string[] = [];

  if (latestSignal?.severity === "critical") {
    tasks.push(`Investigate critical production signal: ${latestSignal.summary}`);
    if (latestRelease && latestRelease.status !== "rolled_back") {
      commands.push(`vibent release rollback ${latestRelease.id} --reason "critical signal"`);
    }
    risks.push("Production health is degraded.");
  } else if (latestFailure) {
    tasks.push("Fix the latest failing verification signal.");
    commands.push(`vibent verify ${latestFailure.pointers.runId ?? latestRun?.id ?? ""}`.trim());
    risks.push("Recent changes are still failing tests.");
  } else if (latestRun) {
    tasks.push("Review the latest verified run and confirm scope.");
    commands.push(`vibent replay ${latestRun.id}`);
    commands.push(`vibent verify ${latestRun.id}`);
    if (latestRelease && latestRelease.status === "canary") {
      tasks.push(`Promote or rollback canary release ${latestRelease.id} in ${latestRelease.environment}.`);
      commands.push(`vibent release promote ${latestRelease.id} --traffic 100`);
      commands.push(`vibent release rollback ${latestRelease.id} --reason "canary regression"`);
    }
  } else {
    tasks.push("Create a new run and define the immediate goal.");
    commands.push('vibent run "describe next change"');
  }

  if (latestSnapshot?.lastKnownGood) {
    tasks.push(`Compare current work against last known good run ${latestSnapshot.lastKnownGood}.`);
  }

  return store.createResumePlan({
    sessionId: session.id,
    tasks,
    suggestedCommands: commands.filter(Boolean),
    risks
  });
}

export function querySessionMemory(
  store: LocalStore,
  session: SessionRecord,
  input: MemoryQueryInput
): MemoryQueryOutput {
  const limit = input.limit ?? 5;
  const queryTokens = tokenize(input.query ?? "");
  const fileHints = (input.files ?? []).map((file) => file.toLowerCase());
  const symbolHints = (input.symbols ?? []).map((symbol) => symbol.toLowerCase());
  const fullTokenSet = [...queryTokens, ...symbolHints];

  const highlights = store
    .listHighlights(session.id)
    .map((highlight) => ({
      highlight,
      score: highlightScore(highlight, fullTokenSet, fileHints)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.highlight);

  const priorRuns = store
    .listRunsForSession(session.id)
    .map((run) => ({ run, score: runScore(run, fullTokenSet, fileHints) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.run);

  const failures = highlights.filter((highlight) => highlight.type === "failure").slice(0, limit);
  const fixes = highlights.filter((highlight) => highlight.type === "fix").slice(0, limit);
  const suggestedNextSteps = store
    .listHighlights(session.id)
    .filter((highlight) => highlight.type === "next_step")
    .slice(0, limit)
    .map((highlight) => highlight.text);

  return {
    highlights,
    priorRuns,
    failures,
    fixes,
    suggestedNextSteps
  };
}

function normalizedFileSet(files: string[]): Set<string> {
  return new Set(files.map((file) => file.trim().toLowerCase()).filter(Boolean));
}

export function findSimilarFailedRun(
  store: LocalStore,
  sessionId: string,
  run: RunRecord
): { run: RunRecord; reason: string } | null {
  const baseline = normalizedFileSet(run.changedFiles);
  if (baseline.size === 0) return null;

  const priorRuns = store.listRunsForSession(sessionId).filter((candidate) => candidate.id !== run.id);
  for (const candidate of priorRuns) {
    const evals = store.getEvals(candidate.id);
    const hasFailure = evals.some((evalResult) => !evalResult.passed);
    if (!hasFailure) continue;

    const candidateFiles = normalizedFileSet(candidate.changedFiles);
    let overlap = 0;
    for (const file of baseline) {
      if (candidateFiles.has(file)) overlap += 1;
    }

    const overlapRatio = overlap / Math.max(1, Math.min(baseline.size, candidateFiles.size));
    if (overlapRatio < 0.5) continue;

    const latestFailure = evals.find((evalResult) => !evalResult.passed);
    const reason = latestFailure?.summary ?? "previous checks failed";
    return { run: candidate, reason };
  }

  return null;
}
