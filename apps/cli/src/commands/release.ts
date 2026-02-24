import { buildResumePlan, buildSnapshot } from "../lib/memory.js";
import { getRepoRoot } from "../lib/git.js";
import { LocalStore } from "../lib/store.js";

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function releaseVersion(runId: string): string {
  return `${new Date().toISOString().slice(0, 10)}-${runId.slice(-6)}`;
}

export async function releaseCreateCommandHandler(options: {
  runId?: string;
  environment?: string;
  trafficPercent?: number;
  notes?: string;
}): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const run = options.runId ? store.getRun(options.runId) : store.latestRun();
  if (!run) {
    throw new Error("No run found to release.");
  }

  const latestReview = store.latestReview(run.id);
  if (!latestReview || !latestReview.passed) {
    throw new Error("Release requires a passing review. Run `vibent review` first.");
  }

  const trafficPercent = clampPercent(options.trafficPercent ?? 10);
  const release = store.createRelease({
    runId: run.id,
    bundleId: null,
    environment: options.environment ?? "dev",
    status: trafficPercent >= 100 ? "stable" : "canary",
    trafficPercent,
    version: releaseVersion(run.id),
    notes: options.notes ?? ""
  });

  if (run.sessionId) {
    const session = store.getSession(run.sessionId);
    if (session) {
      store.createHighlight({
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text:
          release.status === "stable"
            ? `Release ${release.id} is stable at 100% traffic in ${release.environment}.`
            : `Release ${release.id} started canary at ${release.trafficPercent}% in ${release.environment}.`,
        pointers: { runId: run.id, files: run.changedFiles }
      });
      buildSnapshot(store, session, `Release ${release.id} ${release.status}`, process.env);
      buildResumePlan(store, session);
    }
  }

  console.log(`Release: ${release.id}`);
  console.log(`Run: ${release.runId}`);
  console.log(`Environment: ${release.environment}`);
  console.log(`Status: ${release.status}`);
  console.log(`Traffic: ${release.trafficPercent}%`);
}

export async function releasePromoteCommandHandler(releaseId: string, trafficPercent = 100): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const release = store.getRelease(releaseId);
  if (!release) {
    throw new Error("Release not found.");
  }

  release.trafficPercent = clampPercent(trafficPercent);
  release.status = release.trafficPercent >= 100 ? "stable" : "canary";
  store.updateRelease(release);

  const run = store.getRun(release.runId);
  if (run?.sessionId) {
    const session = store.getSession(run.sessionId);
    if (session) {
      store.createHighlight({
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text:
          release.status === "stable"
            ? `Release ${release.id} promoted to stable.`
            : `Release ${release.id} promoted to ${release.trafficPercent}% traffic.`,
        pointers: { runId: run.id, files: run.changedFiles }
      });
      buildSnapshot(store, session, `Release ${release.id} promoted`, process.env);
      buildResumePlan(store, session);
    }
  }

  console.log(`Release ${release.id} traffic is now ${release.trafficPercent}% (${release.status}).`);
}

export async function releaseRollbackCommandHandler(releaseId: string, reason = "manual rollback"): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const release = store.getRelease(releaseId);
  if (!release) {
    throw new Error("Release not found.");
  }

  release.trafficPercent = 0;
  release.status = "rolled_back";
  release.notes = release.notes ? `${release.notes}\nRollback: ${reason}` : `Rollback: ${reason}`;
  store.updateRelease(release);

  const run = store.getRun(release.runId);
  if (run?.sessionId) {
    const session = store.getSession(run.sessionId);
    if (session) {
      store.createSignal({
        sessionId: session.id,
        runId: run.id,
        source: "release",
        type: "rollback",
        severity: "critical",
        summary: `Release ${release.id} rolled back: ${reason}`,
        metricValue: 0,
        unit: "percent"
      });
      store.createHighlight({
        sessionId: session.id,
        runId: run.id,
        type: "regression",
        text: `Release ${release.id} rolled back. Reason: ${reason}`,
        pointers: { runId: run.id, files: run.changedFiles }
      });
      buildSnapshot(store, session, `Release ${release.id} rolled back`, process.env);
      buildResumePlan(store, session);
    }
  }

  console.log(`Release ${release.id} rolled back.`);
}

export async function releaseListCommandHandler(runId?: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const releases = store.listReleases(runId);
  if (releases.length === 0) {
    console.log("No releases found.");
    return;
  }
  for (const release of releases) {
    console.log(
      `${release.id} | run=${release.runId} | env=${release.environment} | ${release.status} | traffic=${release.trafficPercent}% | ${release.updatedAt}`
    );
  }
}
