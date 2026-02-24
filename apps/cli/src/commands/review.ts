import { buildResumePlan, buildSnapshot } from "../lib/memory.js";
import { getRepoRoot } from "../lib/git.js";
import { runAutomatedReview } from "../lib/review.js";
import { LocalStore } from "../lib/store.js";

export async function reviewCommandHandler(runIdArg?: string, commandsArg?: string[]): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const run = runIdArg ? store.getRun(runIdArg) : store.latestRun();

  if (!run) {
    throw new Error("No run found. Execute vibent run first.");
  }

  const review = await runAutomatedReview({
    store,
    run,
    repoRoot,
    commands: commandsArg
  });

  const session = run.sessionId ? store.getSession(run.sessionId) : null;
  if (session) {
    store.createEvent({
      sessionId: session.id,
      runId: run.id,
      type: review.passed ? "build" : "error",
      payload: {
        summary: review.summary,
        review_id: review.id
      }
    });
    store.createHighlight({
      sessionId: session.id,
      runId: run.id,
      type: review.passed ? "fix" : "failure",
      text: review.passed
        ? `Review passed for ${run.id}. ${review.summary}`
        : `Review blocked for ${run.id}. ${review.summary}`,
      pointers: {
        runId: run.id,
        files: run.changedFiles,
        artifacts: review.findings.map((finding) => finding.artifactPointer).filter((pointer): pointer is string => !!pointer)
      },
      confidence: review.passed ? 0.9 : 0.95
    });
    if (!review.passed) {
      const blocking = review.findings
        .filter((finding) => finding.severity === "high" || finding.severity === "critical")
        .map((finding) => `${finding.category}: ${finding.title}`)
        .slice(0, 3)
        .join(" | ");
      store.createHighlight({
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text: `Next: resolve blocking review findings (${blocking || "see review output"}) and rerun vibent review ${run.id}.`,
        pointers: { runId: run.id, files: run.changedFiles }
      });
    }
    buildSnapshot(store, session, review.summary, process.env);
    buildResumePlan(store, session);
  }

  console.log(`Run: ${run.id}`);
  console.log(`Review: ${review.id}`);
  console.log(`Result: ${review.passed ? "passed" : "failed"}`);
  console.log(`Summary: ${review.summary}`);
  if (review.findings.length > 0) {
    console.log("Findings:");
    for (const finding of review.findings) {
      const blocker = finding.severity === "high" || finding.severity === "critical" ? " (blocking)" : "";
      console.log(`- [${finding.severity}] ${finding.category}: ${finding.title}${blocker}`);
    }
  }
}
