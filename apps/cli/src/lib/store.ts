import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RunStatus = "Draft" | "Verified" | "Published";
export type SessionStatus = "active" | "archived";
export type SessionEventType =
  | "prompt"
  | "file_read"
  | "file_write"
  | "search"
  | "command"
  | "test_run"
  | "build"
  | "error"
  | "decision"
  | "note"
  | "link";
export type HighlightType =
  | "goal"
  | "constraint"
  | "finding"
  | "failure"
  | "fix"
  | "regression"
  | "performance_delta"
  | "next_step"
  | "open_question";

export interface RunRecord {
  id: string;
  goal: string;
  baseRef: string;
  baseSha: string;
  patchPointer: string;
  evalPointers: string[];
  transcriptPointer: string | null;
  reproducibility: "replayable-locally" | "server-only";
  status: RunStatus;
  changedFiles: string[];
  scopeHints?: string[];
  reviewPointers?: string[];
  releasePointers?: string[];
  sessionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvalRecord {
  id: string;
  runId: string;
  commands: string[];
  passed: boolean;
  summary: string;
  artifactPointer: string;
  environmentFingerprint?: string;
  createdAt: string;
}

export type ReviewFindingSeverity = "info" | "low" | "medium" | "high" | "critical";
export type ReviewFindingCategory = "lint" | "test" | "security" | "dependency" | "policy" | "release";

export interface ReviewFindingRecord {
  id: string;
  runId: string;
  category: ReviewFindingCategory;
  severity: ReviewFindingSeverity;
  title: string;
  detail: string;
  command: string | null;
  artifactPointer: string | null;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  runId: string;
  passed: boolean;
  summary: string;
  commands: string[];
  findings: ReviewFindingRecord[];
  createdAt: string;
}

export type ReleaseStatus = "created" | "deploying" | "canary" | "stable" | "rolled_back" | "failed";

export interface ReleaseRecord {
  id: string;
  runId: string;
  bundleId: string | null;
  environment: string;
  status: ReleaseStatus;
  trafficPercent: number;
  version: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionSignalRecord {
  id: string;
  sessionId: string | null;
  runId: string | null;
  source: string;
  type: "error_rate" | "latency" | "availability" | "rollback" | "cost" | "throughput";
  severity: "info" | "warning" | "critical";
  summary: string;
  metricValue: number | null;
  unit: string | null;
  createdAt: string;
}

export interface EvalPlan {
  id: string;
  runId: string;
  commands: string[];
  maxSeconds: number;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  repoId: string;
  startedAt: string;
  lastActiveAt: string;
  createdBy: string;
  branchRef: string | null;
  title: string;
  status: SessionStatus;
  pinned: boolean;
  summary: string;
  linkedRuns: string[];
}

export interface SessionEventRecord {
  id: string;
  sessionId: string;
  runId: string | null;
  ts: string;
  type: SessionEventType;
  payload: Record<string, unknown>;
  artifactPointer: string | null;
}

export interface HighlightRecord {
  id: string;
  sessionId: string;
  runId: string | null;
  type: HighlightType;
  text: string;
  pointers: {
    runId?: string;
    files: string[];
    evalIds: string[];
    artifacts: string[];
  };
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnownFailure {
  text: string;
  runId?: string;
  links: string[];
}

export interface MemorySnapshotRecord {
  id: string;
  sessionId: string;
  touchedFiles: string[];
  touchedSymbols: string[];
  keyDecisions: string[];
  knownFailures: KnownFailure[];
  lastKnownGood: string | null;
  environmentFingerprint: string;
  testStatusSummary: string;
  createdAt: string;
}

export interface ResumePlanRecord {
  id: string;
  sessionId: string;
  tasks: string[];
  suggestedCommands: string[];
  risks: string[];
  createdAt: string;
  updatedAt: string;
}

interface IndexFile {
  runs: string[];
  sessions: string[];
  githubConnected: boolean;
  activeSessionId: string | null;
  extendedSessionLogs: boolean;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function createLocalId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toSortedByTimeDesc<T>(items: T[], readTime: (item: T) => string): T[] {
  return items.sort((a, b) => readTime(b).localeCompare(readTime(a)));
}

export class LocalStore {
  readonly root: string;
  readonly vibentDir: string;

  constructor(repoRoot: string) {
    this.root = repoRoot;
    this.vibentDir = path.join(repoRoot, ".vibent");
    fs.mkdirSync(this.vibentDir, { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "runs"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "evals"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "plans"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "sessions"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "events"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "highlights"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "snapshots"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "resume"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "reviews"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "releases"), { recursive: true });
    fs.mkdirSync(path.join(this.vibentDir, "signals"), { recursive: true });

    const indexFile = this.indexFile();
    if (!fs.existsSync(indexFile)) {
      this.writeIndex({
        runs: [],
        sessions: [],
        githubConnected: false,
        activeSessionId: null,
        extendedSessionLogs: false
      });
      return;
    }

    const current = this.readIndex();
    this.writeIndex(current);
  }

  private indexFile(): string {
    return path.join(this.vibentDir, "index.json");
  }

  private runFile(runId: string): string {
    return path.join(this.runDir(runId), "run.json");
  }

  private sessionFile(sessionId: string): string {
    return path.join(this.vibentDir, "sessions", `${sessionId}.json`);
  }

  private eventFile(eventId: string): string {
    return path.join(this.vibentDir, "events", `${eventId}.json`);
  }

  private highlightFile(highlightId: string): string {
    return path.join(this.vibentDir, "highlights", `${highlightId}.json`);
  }

  private snapshotFile(snapshotId: string): string {
    return path.join(this.vibentDir, "snapshots", `${snapshotId}.json`);
  }

  private resumeFile(resumeId: string): string {
    return path.join(this.vibentDir, "resume", `${resumeId}.json`);
  }

  private reviewFile(reviewId: string): string {
    return path.join(this.vibentDir, "reviews", `${reviewId}.json`);
  }

  private releaseFile(releaseId: string): string {
    return path.join(this.vibentDir, "releases", `${releaseId}.json`);
  }

  private signalFile(signalId: string): string {
    return path.join(this.vibentDir, "signals", `${signalId}.json`);
  }

  private readIndex(): IndexFile {
    const raw = readJson<Partial<IndexFile>>(this.indexFile());
    return {
      runs: raw.runs ?? [],
      sessions: raw.sessions ?? [],
      githubConnected: raw.githubConnected ?? false,
      activeSessionId: raw.activeSessionId ?? null,
      extendedSessionLogs: raw.extendedSessionLogs ?? false
    };
  }

  private writeIndex(data: IndexFile): void {
    fs.writeFileSync(this.indexFile(), JSON.stringify(data, null, 2));
  }

  setGithubConnected(connected: boolean): void {
    const index = this.readIndex();
    index.githubConnected = connected;
    this.writeIndex(index);
  }

  isGithubConnected(): boolean {
    return this.readIndex().githubConnected;
  }

  setExtendedSessionLogs(enabled: boolean): void {
    const index = this.readIndex();
    index.extendedSessionLogs = enabled;
    this.writeIndex(index);
  }

  isExtendedSessionLogsEnabled(): boolean {
    return this.readIndex().extendedSessionLogs;
  }

  runDir(runId: string): string {
    return path.join(this.vibentDir, "runs", runId);
  }

  saveRun(run: RunRecord, patch: string): void {
    const dir = this.runDir(run.id);
    fs.mkdirSync(dir, { recursive: true });

    const patchPath = path.join(dir, "patch.diff");
    fs.writeFileSync(patchPath, patch);
    run.patchPointer = patchPath;
    run.reviewPointers = run.reviewPointers ?? [];
    run.releasePointers = run.releasePointers ?? [];

    fs.writeFileSync(this.runFile(run.id), JSON.stringify(run, null, 2));

    const index = this.readIndex();
    if (!index.runs.includes(run.id)) {
      index.runs.push(run.id);
      this.writeIndex(index);
    }

    if (run.sessionId) {
      this.linkRunToSession(run.id, run.sessionId);
    }
  }

  updateRun(run: RunRecord): void {
    fs.writeFileSync(this.runFile(run.id), JSON.stringify(run, null, 2));
  }

  getRun(runId: string): RunRecord | null {
    const file = this.runFile(runId);
    if (!fs.existsSync(file)) return null;
    const run = readJson<RunRecord>(file);
    run.evalPointers = run.evalPointers ?? [];
    run.reviewPointers = run.reviewPointers ?? [];
    run.releasePointers = run.releasePointers ?? [];
    return run;
  }

  listRuns(): RunRecord[] {
    const index = this.readIndex();
    const runs = index.runs.map((id) => this.getRun(id)).filter((r): r is RunRecord => !!r);
    return toSortedByTimeDesc(runs, (run) => run.createdAt);
  }

  latestRun(): RunRecord | null {
    return this.listRuns()[0] ?? null;
  }

  saveEval(evalResult: EvalRecord): void {
    const file = path.join(this.vibentDir, "evals", `${evalResult.id}.json`);
    fs.writeFileSync(file, JSON.stringify(evalResult, null, 2));

    const run = this.getRun(evalResult.runId);
    if (run) {
      run.evalPointers = unique([...run.evalPointers, evalResult.id]);
      run.status = evalResult.passed ? "Verified" : run.status;
      run.updatedAt = new Date().toISOString();
      this.updateRun(run);

      if (run.sessionId) {
        this.touchSession(run.sessionId);
      }
    }
  }

  getEval(evalId: string): EvalRecord | null {
    const file = path.join(this.vibentDir, "evals", `${evalId}.json`);
    if (!fs.existsSync(file)) return null;
    return readJson<EvalRecord>(file);
  }

  getEvals(runId: string): EvalRecord[] {
    const run = this.getRun(runId);
    if (!run) return [];
    return run.evalPointers.map((id) => this.getEval(id)).filter((e): e is EvalRecord => !!e);
  }

  savePlan(plan: EvalPlan): void {
    const file = path.join(this.vibentDir, "plans", `${plan.id}.json`);
    fs.writeFileSync(file, JSON.stringify(plan, null, 2));
  }

  getPlan(planId: string): EvalPlan | null {
    const file = path.join(this.vibentDir, "plans", `${planId}.json`);
    if (!fs.existsSync(file)) return null;
    return readJson<EvalPlan>(file);
  }

  artifactPath(name: string): string {
    return path.join(this.vibentDir, "artifacts", name);
  }

  createSession(input: {
    title: string;
    createdBy?: string;
    repoId?: string;
    branchRef?: string | null;
    summary?: string;
  }): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: createLocalId("sess"),
      repoId: input.repoId ?? path.basename(this.root),
      startedAt: now,
      lastActiveAt: now,
      createdBy: input.createdBy ?? "local-user",
      branchRef: input.branchRef ?? null,
      title: input.title,
      status: "active",
      pinned: false,
      summary: input.summary ?? "",
      linkedRuns: []
    };
    this.saveSession(session);
    this.setActiveSession(session.id);
    return session;
  }

  saveSession(session: SessionRecord): void {
    fs.writeFileSync(this.sessionFile(session.id), JSON.stringify(session, null, 2));

    const index = this.readIndex();
    if (!index.sessions.includes(session.id)) {
      index.sessions.push(session.id);
      this.writeIndex(index);
    }
  }

  getSession(sessionId: string): SessionRecord | null {
    const file = this.sessionFile(sessionId);
    if (!fs.existsSync(file)) return null;
    return readJson<SessionRecord>(file);
  }

  listSessions(opts?: { includeArchived?: boolean; query?: string }): SessionRecord[] {
    const index = this.readIndex();
    let sessions = index.sessions
      .map((id) => this.getSession(id))
      .filter((session): session is SessionRecord => !!session);

    if (!opts?.includeArchived) {
      sessions = sessions.filter((session) => session.status === "active");
    }

    if (opts?.query) {
      const q = opts.query.toLowerCase();
      sessions = sessions.filter(
        (session) =>
          session.title.toLowerCase().includes(q) ||
          session.summary.toLowerCase().includes(q) ||
          session.id.toLowerCase().includes(q)
      );
    }

    return toSortedByTimeDesc(sessions, (session) => session.lastActiveAt);
  }

  latestSession(): SessionRecord | null {
    return this.listSessions({ includeArchived: true })[0] ?? null;
  }

  setActiveSession(sessionId: string | null): void {
    const index = this.readIndex();
    index.activeSessionId = sessionId;
    this.writeIndex(index);
  }

  getActiveSessionId(): string | null {
    return this.readIndex().activeSessionId;
  }

  getActiveSession(): SessionRecord | null {
    const id = this.getActiveSessionId();
    if (!id) return null;
    const session = this.getSession(id);
    if (!session || session.status !== "active") {
      this.setActiveSession(null);
      return null;
    }
    return session;
  }

  continueSession(sessionId: string): SessionRecord | null {
    const session = this.getSession(sessionId);
    if (!session || session.status !== "active") {
      return null;
    }
    session.lastActiveAt = new Date().toISOString();
    this.saveSession(session);
    this.setActiveSession(sessionId);
    return session;
  }

  ensureActiveSession(goal: string): SessionRecord {
    const current = this.getActiveSession();
    if (current) return current;
    return this.createSession({ title: goal });
  }

  archiveSession(sessionId: string): SessionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.status = "archived";
    session.lastActiveAt = new Date().toISOString();
    this.saveSession(session);
    if (this.getActiveSessionId() === sessionId) {
      this.setActiveSession(null);
    }
    return session;
  }

  pinSession(sessionId: string, pinned: boolean): SessionRecord | null {
    const session = this.getSession(sessionId);
    if (!session) return null;
    session.pinned = pinned;
    session.lastActiveAt = new Date().toISOString();
    this.saveSession(session);
    return session;
  }

  touchSession(sessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    session.lastActiveAt = new Date().toISOString();
    this.saveSession(session);
  }

  linkRunToSession(runId: string, sessionId: string): void {
    const run = this.getRun(runId);
    const session = this.getSession(sessionId);
    if (!run || !session) return;

    run.sessionId = session.id;
    run.updatedAt = new Date().toISOString();
    this.updateRun(run);

    session.linkedRuns = unique([...session.linkedRuns, run.id]);
    session.lastActiveAt = new Date().toISOString();
    this.saveSession(session);

    if (this.getActiveSessionId() !== session.id && session.status === "active") {
      this.setActiveSession(session.id);
    }
  }

  listRunsForSession(sessionId: string): RunRecord[] {
    const session = this.getSession(sessionId);
    if (!session) return [];
    return session.linkedRuns
      .map((runId) => this.getRun(runId))
      .filter((run): run is RunRecord => !!run)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  saveEvent(event: SessionEventRecord): void {
    fs.writeFileSync(this.eventFile(event.id), JSON.stringify(event, null, 2));
    this.touchSession(event.sessionId);
  }

  createEvent(input: {
    sessionId: string;
    runId?: string | null;
    type: SessionEventType;
    payload: Record<string, unknown>;
    artifactPointer?: string | null;
    ts?: string;
  }): SessionEventRecord {
    const event: SessionEventRecord = {
      id: createLocalId("evt"),
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      ts: input.ts ?? new Date().toISOString(),
      type: input.type,
      payload: input.payload,
      artifactPointer: input.artifactPointer ?? null
    };
    this.saveEvent(event);
    return event;
  }

  listSessionEvents(sessionId: string, opts?: { limit?: number; type?: SessionEventType }): SessionEventRecord[] {
    const dir = path.join(this.vibentDir, "events");
    if (!fs.existsSync(dir)) return [];

    let events = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<SessionEventRecord>(path.join(dir, name)))
      .filter((event) => event.sessionId === sessionId);

    if (opts?.type) {
      events = events.filter((event) => event.type === opts.type);
    }

    events = toSortedByTimeDesc(events, (event) => event.ts);
    if (!opts?.limit) return events;
    return events.slice(0, opts.limit);
  }

  addNote(sessionId: string, text: string, runId?: string): SessionEventRecord {
    return this.createEvent({
      sessionId,
      runId,
      type: "note",
      payload: { text }
    });
  }

  saveHighlight(highlight: HighlightRecord): void {
    fs.writeFileSync(this.highlightFile(highlight.id), JSON.stringify(highlight, null, 2));
    this.touchSession(highlight.sessionId);
  }

  createHighlight(input: {
    sessionId: string;
    runId?: string | null;
    type: HighlightType;
    text: string;
    pointers?: Partial<HighlightRecord["pointers"]>;
    confidence?: number | null;
  }): HighlightRecord {
    const now = new Date().toISOString();
    const highlight: HighlightRecord = {
      id: createLocalId("hl"),
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
    };
    this.saveHighlight(highlight);
    return highlight;
  }

  listHighlights(sessionId: string, limit?: number): HighlightRecord[] {
    const dir = path.join(this.vibentDir, "highlights");
    if (!fs.existsSync(dir)) return [];

    const highlights = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<HighlightRecord>(path.join(dir, name)))
      .filter((highlight) => highlight.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (!limit) return highlights;
    return highlights.slice(0, limit);
  }

  saveSnapshot(snapshot: MemorySnapshotRecord): void {
    fs.writeFileSync(this.snapshotFile(snapshot.id), JSON.stringify(snapshot, null, 2));
    this.touchSession(snapshot.sessionId);
  }

  createSnapshot(input: Omit<MemorySnapshotRecord, "id" | "createdAt">): MemorySnapshotRecord {
    const snapshot: MemorySnapshotRecord = {
      id: createLocalId("snap"),
      ...input,
      createdAt: new Date().toISOString()
    };
    this.saveSnapshot(snapshot);
    return snapshot;
  }

  listSnapshots(sessionId: string): MemorySnapshotRecord[] {
    const dir = path.join(this.vibentDir, "snapshots");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<MemorySnapshotRecord>(path.join(dir, name)))
      .filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  latestSnapshot(sessionId: string): MemorySnapshotRecord | null {
    return this.listSnapshots(sessionId)[0] ?? null;
  }

  saveResumePlan(plan: ResumePlanRecord): void {
    fs.writeFileSync(this.resumeFile(plan.id), JSON.stringify(plan, null, 2));
    this.touchSession(plan.sessionId);
  }

  createResumePlan(input: Omit<ResumePlanRecord, "id" | "createdAt" | "updatedAt">): ResumePlanRecord {
    const now = new Date().toISOString();
    const plan: ResumePlanRecord = {
      id: createLocalId("resume"),
      ...input,
      createdAt: now,
      updatedAt: now
    };
    this.saveResumePlan(plan);
    return plan;
  }

  listResumePlans(sessionId: string): ResumePlanRecord[] {
    const dir = path.join(this.vibentDir, "resume");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<ResumePlanRecord>(path.join(dir, name)))
      .filter((plan) => plan.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  latestResumePlan(sessionId: string): ResumePlanRecord | null {
    return this.listResumePlans(sessionId)[0] ?? null;
  }

  saveReview(review: ReviewRecord): void {
    fs.writeFileSync(this.reviewFile(review.id), JSON.stringify(review, null, 2));
    const run = this.getRun(review.runId);
    if (!run) return;
    run.reviewPointers = unique([...(run.reviewPointers ?? []), review.id]);
    run.updatedAt = new Date().toISOString();
    this.updateRun(run);
    if (run.sessionId) {
      this.touchSession(run.sessionId);
    }
  }

  createReview(input: Omit<ReviewRecord, "id" | "createdAt">): ReviewRecord {
    const review: ReviewRecord = {
      id: createLocalId("review"),
      ...input,
      createdAt: new Date().toISOString()
    };
    this.saveReview(review);
    return review;
  }

  getReview(reviewId: string): ReviewRecord | null {
    const file = this.reviewFile(reviewId);
    if (!fs.existsSync(file)) return null;
    return readJson<ReviewRecord>(file);
  }

  listReviews(runId?: string): ReviewRecord[] {
    const dir = path.join(this.vibentDir, "reviews");
    if (!fs.existsSync(dir)) return [];
    let reviews = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<ReviewRecord>(path.join(dir, name)));
    if (runId) {
      reviews = reviews.filter((review) => review.runId === runId);
    }
    return toSortedByTimeDesc(reviews, (review) => review.createdAt);
  }

  latestReview(runId: string): ReviewRecord | null {
    return this.listReviews(runId)[0] ?? null;
  }

  saveRelease(release: ReleaseRecord): void {
    fs.writeFileSync(this.releaseFile(release.id), JSON.stringify(release, null, 2));
    const run = this.getRun(release.runId);
    if (!run) return;
    run.releasePointers = unique([...(run.releasePointers ?? []), release.id]);
    run.updatedAt = new Date().toISOString();
    this.updateRun(run);
    if (run.sessionId) {
      this.touchSession(run.sessionId);
    }
  }

  createRelease(input: Omit<ReleaseRecord, "id" | "createdAt" | "updatedAt">): ReleaseRecord {
    const now = new Date().toISOString();
    const release: ReleaseRecord = {
      id: createLocalId("rel"),
      ...input,
      createdAt: now,
      updatedAt: now
    };
    this.saveRelease(release);
    return release;
  }

  getRelease(releaseId: string): ReleaseRecord | null {
    const file = this.releaseFile(releaseId);
    if (!fs.existsSync(file)) return null;
    return readJson<ReleaseRecord>(file);
  }

  updateRelease(release: ReleaseRecord): void {
    release.updatedAt = new Date().toISOString();
    this.saveRelease(release);
  }

  listReleases(runId?: string): ReleaseRecord[] {
    const dir = path.join(this.vibentDir, "releases");
    if (!fs.existsSync(dir)) return [];
    let releases = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<ReleaseRecord>(path.join(dir, name)));
    if (runId) {
      releases = releases.filter((release) => release.runId === runId);
    }
    return toSortedByTimeDesc(releases, (release) => release.updatedAt);
  }

  saveSignal(signal: ProductionSignalRecord): void {
    fs.writeFileSync(this.signalFile(signal.id), JSON.stringify(signal, null, 2));
    if (signal.sessionId) {
      this.touchSession(signal.sessionId);
    }
  }

  createSignal(input: Omit<ProductionSignalRecord, "id" | "createdAt">): ProductionSignalRecord {
    const signal: ProductionSignalRecord = {
      id: createLocalId("sig"),
      ...input,
      createdAt: new Date().toISOString()
    };
    this.saveSignal(signal);
    return signal;
  }

  listSignals(opts?: { sessionId?: string; runId?: string; limit?: number }): ProductionSignalRecord[] {
    const dir = path.join(this.vibentDir, "signals");
    if (!fs.existsSync(dir)) return [];
    let signals = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<ProductionSignalRecord>(path.join(dir, name)));
    if (opts?.sessionId) {
      signals = signals.filter((signal) => signal.sessionId === opts.sessionId);
    }
    if (opts?.runId) {
      signals = signals.filter((signal) => signal.runId === opts.runId);
    }
    signals = toSortedByTimeDesc(signals, (signal) => signal.createdAt);
    if (!opts?.limit) return signals;
    return signals.slice(0, opts.limit);
  }

  cleanupRetention(config?: { eventRetentionDays?: number; artifactRetentionDays?: number }): {
    removedEvents: number;
    removedArtifacts: number;
  } {
    const eventRetentionDays = config?.eventRetentionDays ?? 30;
    const artifactRetentionDays = config?.artifactRetentionDays ?? 14;
    const eventCutoff = Date.now() - eventRetentionDays * 24 * 60 * 60 * 1000;
    const artifactCutoff = Date.now() - artifactRetentionDays * 24 * 60 * 60 * 1000;
    const pinnedSessions = new Set(
      this.listSessions({ includeArchived: true })
        .filter((session) => session.pinned)
        .map((session) => session.id)
    );

    const eventDir = path.join(this.vibentDir, "events");
    let removedEvents = 0;
    if (fs.existsSync(eventDir)) {
      for (const name of fs.readdirSync(eventDir)) {
        if (!name.endsWith(".json")) continue;
        const file = path.join(eventDir, name);
        const event = readJson<SessionEventRecord>(file);
        if (pinnedSessions.has(event.sessionId)) continue;
        if (new Date(event.ts).getTime() < eventCutoff) {
          fs.unlinkSync(file);
          removedEvents += 1;
        }
      }
    }

    const pinnedRunIds = new Set<string>();
    for (const sessionId of pinnedSessions) {
      const session = this.getSession(sessionId);
      if (!session) continue;
      for (const runId of session.linkedRuns) {
        pinnedRunIds.add(runId);
      }
    }

    const protectedArtifacts = new Set<string>();
    for (const runId of pinnedRunIds) {
      const run = this.getRun(runId);
      if (!run) continue;
      for (const evalId of run.evalPointers) {
        const evalResult = this.getEval(evalId);
        if (!evalResult) continue;
        protectedArtifacts.add(path.resolve(evalResult.artifactPointer));
      }
    }

    const artifactDir = path.join(this.vibentDir, "artifacts");
    let removedArtifacts = 0;
    if (fs.existsSync(artifactDir)) {
      for (const name of fs.readdirSync(artifactDir)) {
        const file = path.join(artifactDir, name);
        if (!fs.statSync(file).isFile()) continue;
        if (protectedArtifacts.has(path.resolve(file))) continue;
        const modifiedAt = fs.statSync(file).mtimeMs;
        if (modifiedAt < artifactCutoff) {
          fs.unlinkSync(file);
          removedArtifacts += 1;
        }
      }
    }

    return { removedEvents, removedArtifacts };
  }
}
