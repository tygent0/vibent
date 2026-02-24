import fs from "node:fs";
import path from "node:path";
import {
  EvalResult,
  Highlight,
  MemorySnapshot,
  ProductionSignal,
  Release,
  ReviewResult,
  ResumePlan,
  Run,
  Session,
  SessionEvent
} from "@vibent/shared";

export interface Bundle {
  id: string;
  runId: string;
  mode?: "pr" | "direct";
  prUrl?: string;
  summary: string;
  publishedAt: string;
}

interface StoreState {
  runs: Run[];
  evals: EvalResult[];
  bundles: Bundle[];
  reviews: ReviewResult[];
  releases: Release[];
  productionSignals: ProductionSignal[];
  repoConnected: boolean;
  sessions: Session[];
  sessionEvents: SessionEvent[];
  highlights: Highlight[];
  snapshots: MemorySnapshot[];
  resumePlans: ResumePlan[];
  activeSessionId: string | null;
}

const INITIAL_STATE: StoreState = {
  runs: [],
  evals: [],
  bundles: [],
  reviews: [],
  releases: [],
  productionSignals: [],
  repoConnected: false,
  sessions: [],
  sessionEvents: [],
  highlights: [],
  snapshots: [],
  resumePlans: [],
  activeSessionId: null
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class FileStore {
  private readonly stateFile: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.stateFile = path.join(dataDir, "state.json");
    if (!fs.existsSync(this.stateFile)) {
      this.save(INITIAL_STATE);
    }
  }

  private load(): StoreState {
    const raw = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as Partial<StoreState>;
    return {
      runs: raw.runs ?? [],
      evals: raw.evals ?? [],
      bundles: raw.bundles ?? [],
      reviews: raw.reviews ?? [],
      releases: raw.releases ?? [],
      productionSignals: raw.productionSignals ?? [],
      repoConnected: raw.repoConnected ?? false,
      sessions: raw.sessions ?? [],
      sessionEvents: raw.sessionEvents ?? [],
      highlights: raw.highlights ?? [],
      snapshots: raw.snapshots ?? [],
      resumePlans: raw.resumePlans ?? [],
      activeSessionId: raw.activeSessionId ?? null
    };
  }

  private save(state: StoreState): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  listRuns(): Run[] {
    return this.load().runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRun(id: string): Run | undefined {
    return this.load().runs.find((run) => run.id === id);
  }

  upsertRun(run: Run): Run {
    const state = this.load();
    const index = state.runs.findIndex((entry) => entry.id === run.id);
    if (index >= 0) {
      state.runs[index] = run;
    } else {
      state.runs.push(run);
    }
    this.save(state);
    return run;
  }

  upsertEval(evalResult: EvalResult): EvalResult {
    const state = this.load();
    const idx = state.evals.findIndex((entry) => entry.id === evalResult.id);
    if (idx >= 0) {
      state.evals[idx] = evalResult;
    } else {
      state.evals.push(evalResult);
    }

    const runIndex = state.runs.findIndex((run) => run.id === evalResult.runId);
    if (runIndex >= 0) {
      const run = state.runs[runIndex];
      run.evalPointers = unique([...run.evalPointers, evalResult.id]);
      run.status = evalResult.passed ? "Verified" : run.status;
      run.updatedAt = new Date().toISOString();
      state.runs[runIndex] = run;
    }

    this.save(state);
    return evalResult;
  }

  listEvalsForRun(runId: string): EvalResult[] {
    return this.load().evals.filter((entry) => entry.runId === runId);
  }

  saveBundle(bundle: Bundle): Bundle {
    const state = this.load();
    const idx = state.bundles.findIndex((entry) => entry.runId === bundle.runId);
    if (idx >= 0) {
      state.bundles[idx] = bundle;
    } else {
      state.bundles.push(bundle);
    }

    const runIndex = state.runs.findIndex((run) => run.id === bundle.runId);
    if (runIndex >= 0) {
      state.runs[runIndex].status = "Published";
      state.runs[runIndex].updatedAt = new Date().toISOString();
    }

    this.save(state);
    return bundle;
  }

  upsertReview(review: ReviewResult): ReviewResult {
    const state = this.load();
    const idx = state.reviews.findIndex((entry) => entry.id === review.id);
    if (idx >= 0) {
      state.reviews[idx] = review;
    } else {
      state.reviews.push(review);
    }
    this.save(state);
    return review;
  }

  listReviewsForRun(runId: string): ReviewResult[] {
    return this.load()
      .reviews.filter((review) => review.runId === runId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  latestReviewForRun(runId: string): ReviewResult | undefined {
    return this.listReviewsForRun(runId)[0];
  }

  upsertRelease(release: Release): Release {
    const state = this.load();
    const idx = state.releases.findIndex((entry) => entry.id === release.id);
    if (idx >= 0) {
      state.releases[idx] = release;
    } else {
      state.releases.push(release);
    }
    this.save(state);
    return release;
  }

  getRelease(releaseId: string): Release | undefined {
    return this.load().releases.find((release) => release.id === releaseId);
  }

  listReleases(opts?: { runId?: string }): Release[] {
    let releases = this.load().releases;
    if (opts?.runId) {
      releases = releases.filter((release) => release.runId === opts.runId);
    }
    return releases.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  appendProductionSignal(signal: ProductionSignal): ProductionSignal {
    const state = this.load();
    state.productionSignals.push(signal);
    this.save(state);
    return signal;
  }

  listProductionSignals(opts?: { sessionId?: string; runId?: string; limit?: number }): ProductionSignal[] {
    let signals = this.load().productionSignals;
    if (opts?.sessionId) {
      signals = signals.filter((signal) => signal.sessionId === opts.sessionId);
    }
    if (opts?.runId) {
      signals = signals.filter((signal) => signal.runId === opts.runId);
    }
    signals = signals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!opts?.limit) return signals;
    return signals.slice(0, opts.limit);
  }

  setRepoConnection(connected: boolean): void {
    const state = this.load();
    state.repoConnected = connected;
    this.save(state);
  }

  isRepoConnected(): boolean {
    return this.load().repoConnected;
  }

  listSessions(): Session[] {
    return this.load().sessions.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  }

  getSession(sessionId: string): Session | undefined {
    return this.load().sessions.find((session) => session.id === sessionId);
  }

  upsertSession(session: Session): Session {
    const state = this.load();
    const idx = state.sessions.findIndex((entry) => entry.id === session.id);
    if (idx >= 0) {
      state.sessions[idx] = session;
    } else {
      state.sessions.push(session);
    }
    this.save(state);
    return session;
  }

  setActiveSession(sessionId: string | null): void {
    const state = this.load();
    state.activeSessionId = sessionId;
    this.save(state);
  }

  getActiveSession(): Session | undefined {
    const state = this.load();
    if (!state.activeSessionId) return undefined;
    return state.sessions.find((session) => session.id === state.activeSessionId);
  }

  linkRunToSession(runId: string, sessionId: string): void {
    const state = this.load();
    const runIndex = state.runs.findIndex((run) => run.id === runId);
    const sessionIndex = state.sessions.findIndex((session) => session.id === sessionId);
    if (runIndex < 0 || sessionIndex < 0) {
      return;
    }

    const run = state.runs[runIndex] as Run & { sessionId?: string | null };
    run.sessionId = sessionId;
    run.updatedAt = new Date().toISOString();
    state.runs[runIndex] = run;

    const session = state.sessions[sessionIndex];
    session.linkedRuns = unique([...session.linkedRuns, runId]);
    session.lastActiveAt = new Date().toISOString();
    state.sessions[sessionIndex] = session;

    state.activeSessionId = sessionId;
    this.save(state);
  }

  listRunsForSession(sessionId: string): Run[] {
    const state = this.load();
    const session = state.sessions.find((entry) => entry.id === sessionId);
    if (!session) return [];
    return session.linkedRuns
      .map((runId) => state.runs.find((run) => run.id === runId))
      .filter((run): run is Run => !!run)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  appendSessionEvent(event: SessionEvent): SessionEvent {
    const state = this.load();
    state.sessionEvents.push(event);
    this.save(state);
    return event;
  }

  listSessionEvents(sessionId: string): SessionEvent[] {
    return this.load()
      .sessionEvents.filter((event) => event.sessionId === sessionId)
      .sort((a, b) => b.ts.localeCompare(a.ts));
  }

  upsertHighlight(highlight: Highlight): Highlight {
    const state = this.load();
    const idx = state.highlights.findIndex((entry) => entry.id === highlight.id);
    if (idx >= 0) {
      state.highlights[idx] = highlight;
    } else {
      state.highlights.push(highlight);
    }
    this.save(state);
    return highlight;
  }

  listHighlights(sessionId: string): Highlight[] {
    return this.load()
      .highlights.filter((highlight) => highlight.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  upsertSnapshot(snapshot: MemorySnapshot): MemorySnapshot {
    const state = this.load();
    const idx = state.snapshots.findIndex((entry) => entry.id === snapshot.id);
    if (idx >= 0) {
      state.snapshots[idx] = snapshot;
    } else {
      state.snapshots.push(snapshot);
    }
    this.save(state);
    return snapshot;
  }

  latestSnapshot(sessionId: string): MemorySnapshot | undefined {
    return this.listSnapshots(sessionId)[0];
  }

  listSnapshots(sessionId: string): MemorySnapshot[] {
    return this.load()
      .snapshots.filter((snapshot) => snapshot.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  upsertResumePlan(resume: ResumePlan): ResumePlan {
    const state = this.load();
    const idx = state.resumePlans.findIndex((entry) => entry.id === resume.id);
    if (idx >= 0) {
      state.resumePlans[idx] = resume;
    } else {
      state.resumePlans.push(resume);
    }
    this.save(state);
    return resume;
  }

  latestResumePlan(sessionId: string): ResumePlan | undefined {
    return this.listResumePlans(sessionId)[0];
  }

  listResumePlans(sessionId: string): ResumePlan[] {
    return this.load()
      .resumePlans.filter((plan) => plan.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
