import { buildResumePlan, buildSnapshot } from "../lib/memory.js";
import { LocalStore } from "../lib/store.js";
import { publishToApi } from "../lib/http.js";
import { getRepoRoot } from "../lib/git.js";

function parsePr(value?: string): { prUrl?: string; prNumber?: number } {
  if (!value) return {};
  const maybeNumber = Number(value);
  if (!Number.isNaN(maybeNumber) && maybeNumber > 0) {
    return { prNumber: maybeNumber };
  }
  return { prUrl: value };
}

export async function publishCommandHandler(runIdArg?: string, pr?: string, modeArg?: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const mode = modeArg === "direct" ? "direct" : "pr";

  if (mode === "pr" && !store.isGithubConnected()) {
    throw new Error("Publishing requires GitHub connection.");
  }

  const run = runIdArg ? store.getRun(runIdArg) : store.latestRun();
  if (!run) {
    throw new Error("No run found to publish.");
  }
  const latestReview = store.latestReview(run.id);
  if (!latestReview || !latestReview.passed) {
    throw new Error("Publishing requires a passing review. Run `vibent review` first.");
  }

  const prInfo = parsePr(pr);
  const response = await publishToApi({ runId: run.id, mode, ...prInfo });
  run.status = "Published";
  run.updatedAt = new Date().toISOString();
  store.updateRun(run);
  if (run.sessionId) {
    const session = store.getSession(run.sessionId);
    if (session) {
      store.createHighlight({
        sessionId: session.id,
        runId: run.id,
        type: "next_step",
        text:
          mode === "direct"
            ? `Published run ${run.id} in direct mode. Monitor production signals and be ready to rollback.`
            : `Published run ${run.id}. Watch PR feedback and capture follow-up notes.`,
        pointers: {
          runId: run.id,
          files: run.changedFiles,
          evalIds: run.evalPointers,
          artifacts: [run.patchPointer]
        }
      });
      buildSnapshot(store, session, "Run published", process.env);
      buildResumePlan(store, session);
    }
  }

  console.log(`Published run ${run.id} (mode=${mode})`);
  console.log(JSON.stringify(response, null, 2));
}
