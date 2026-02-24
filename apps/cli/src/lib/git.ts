import path from "node:path";
import { runCommand } from "./shell.js";

export async function getRepoRoot(cwd: string): Promise<string> {
  const result = await runCommand("git rev-parse --show-toplevel", cwd);
  if (result.code !== 0) {
    throw new Error("Not inside a git repository");
  }
  return result.stdout.trim();
}

export async function getHeadSha(cwd: string): Promise<string> {
  const result = await runCommand("git rev-parse HEAD", cwd);
  if (result.code !== 0) {
    throw new Error("Could not determine HEAD SHA");
  }
  return result.stdout.trim();
}

export async function getChangedFiles(cwd: string): Promise<string[]> {
  const result = await runCommand("git diff --name-only", cwd);
  if (result.code !== 0) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getCurrentDiff(cwd: string): Promise<string> {
  const result = await runCommand("git diff", cwd);
  if (result.code !== 0) {
    return "";
  }
  return result.stdout;
}

export async function gitBlame(cwd: string, file: string, line: number): Promise<string> {
  const quotedFile = path.relative(cwd, path.resolve(cwd, file));
  const result = await runCommand(`git blame -L ${line},${line} --porcelain -- ${quotedFile}`, cwd);
  if (result.code !== 0) {
    throw new Error(result.stderr || "git blame failed");
  }
  return result.stdout;
}
