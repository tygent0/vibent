import { buildResumePlan, buildSnapshot } from "../lib/memory.js";
import { getRepoRoot } from "../lib/git.js";
import { LocalStore } from "../lib/store.js";

interface AddSignalOptions {
  sessionId?: string;
  runId?: string;
  source?: string;
  type: "error_rate" | "latency" | "availability" | "rollback" | "cost" | "throughput";
  severity: "info" | "warning" | "critical";
  summary: string;
  metricValue?: number;
  unit?: string;
}

export async function signalAddCommandHandler(options: AddSignalOptions): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);

  let run = options.runId ? store.getRun(options.runId) : null;
  const session =
    (options.sessionId ? store.getSession(options.sessionId) : null) ??
    (run?.sessionId ? store.getSession(run.sessionId) : null) ??
    store.getActiveSession();

  if (!run && session?.linkedRuns[0]) {
    run = store.getRun(session.linkedRuns[0]);
  }

  const signal = store.createSignal({
    sessionId: session?.id ?? null,
    runId: run?.id ?? null,
    source: options.source ?? "manual",
    type: options.type,
    severity: options.severity,
    summary: options.summary,
    metricValue: options.metricValue ?? null,
    unit: options.unit ?? null
  });

  if (session) {
    store.createHighlight({
      sessionId: session.id,
      runId: run?.id ?? null,
      type: signal.severity === "critical" ? "regression" : "finding",
      text: `Production signal (${signal.type}): ${signal.summary}`,
      pointers: {
        runId: run?.id,
        files: run?.changedFiles ?? []
      },
      confidence: signal.severity === "critical" ? 0.95 : 0.8
    });
    buildSnapshot(store, session, `Signal: ${signal.type} ${signal.severity}`, process.env);
    buildResumePlan(store, session);
  }

  console.log(`Signal: ${signal.id}`);
  console.log(`${signal.severity.toUpperCase()} ${signal.type}: ${signal.summary}`);
}

export async function signalListCommandHandler(options?: { sessionId?: string; runId?: string; limit?: number }): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const signals = store.listSignals({
    sessionId: options?.sessionId,
    runId: options?.runId,
    limit: options?.limit ?? 20
  });

  if (signals.length === 0) {
    console.log("No signals found.");
    return;
  }

  for (const signal of signals) {
    console.log(
      `${signal.id} | ${signal.severity} | ${signal.type} | ${signal.summary} | session=${signal.sessionId ?? "-"} | run=${signal.runId ?? "-"}`
    );
  }
}
