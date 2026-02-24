import { getRepoRoot, gitBlame } from "../lib/git.js";
import { LocalStore } from "../lib/store.js";

export async function blameCommandHandler(target: string): Promise<void> {
  const [file, lineRaw] = target.split(":");
  const line = Number(lineRaw);
  if (!file || Number.isNaN(line) || line < 1) {
    throw new Error("Usage: vibent blame path/to/file:line");
  }

  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const output = await gitBlame(repoRoot, file, line);
  const commit = output.split("\n")[0].split(" ")[0];

  const run = store.listRuns().find((r) => r.baseSha.startsWith(commit));
  if (run) {
    console.log(`Commit: ${commit}`);
    console.log(`Associated run: ${run.id}`);
    console.log(`Goal: ${run.goal}`);
    return;
  }

  console.log(output);
}
