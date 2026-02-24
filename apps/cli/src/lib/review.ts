import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./shell.js";
import { LocalStore, ReviewFindingRecord, ReviewRecord, RunRecord } from "./store.js";

interface ReviewExecutionInput {
  store: LocalStore;
  run: RunRecord;
  repoRoot: string;
  commands?: string[];
}

interface CommandExecution {
  command: string;
  code: number;
  stdout: string;
  stderr: string;
}

function createFindingId(): string {
  return `finding_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function topLine(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)[0]
    ?.slice(0, 240);
}

function inferDefaultCommands(run: RunRecord): string[] {
  if (run.changedFiles.some((file) => file.startsWith("apps/web/"))) {
    return ["pnpm --filter @vibent/web lint"];
  }
  if (run.changedFiles.some((file) => file.startsWith("apps/api/") || file.startsWith("apps/worker/"))) {
    return ["pnpm --filter @vibent/api lint", "pnpm --filter @vibent/worker lint"];
  }
  return ["pnpm lint"];
}

function staticFindings(run: RunRecord, patch: string): ReviewFindingRecord[] {
  const now = new Date().toISOString();
  const findings: ReviewFindingRecord[] = [];
  const lowerPatch = patch.toLowerCase();

  if ((run.evalPointers ?? []).length === 0) {
    findings.push({
      id: createFindingId(),
      runId: run.id,
      category: "policy",
      severity: "high",
      title: "Verification missing",
      detail: "Run has no eval records. Execute `vibent verify` before publish.",
      command: null,
      artifactPointer: null,
      createdAt: now
    });
  }

  if (
    /(api[_-]?key|token|password|secret)\s*[:=]\s*["']?[a-z0-9_\-]{8,}/i.test(patch) ||
    /(ghp_[a-z0-9]{20,}|xox[baprs]-[a-z0-9-]{10,}|sk-[a-z0-9]{12,})/i.test(patch)
  ) {
    findings.push({
      id: createFindingId(),
      runId: run.id,
      category: "security",
      severity: "critical",
      title: "Potential secret exposure in patch",
      detail: "Detected token/secret-like values in the patch. Remove and rotate before publish.",
      command: null,
      artifactPointer: null,
      createdAt: now
    });
  }

  if (run.changedFiles.some((file) => file === "pnpm-lock.yaml" || file.endsWith("package.json"))) {
    findings.push({
      id: createFindingId(),
      runId: run.id,
      category: "dependency",
      severity: "medium",
      title: "Dependency manifest changed",
      detail: "Dependency files changed. Run targeted regression tests and audit critical packages.",
      command: "pnpm audit --prod",
      artifactPointer: null,
      createdAt: now
    });
  }

  if (run.changedFiles.some((file) => file.startsWith("infra/") || file.endsWith(".tf"))) {
    findings.push({
      id: createFindingId(),
      runId: run.id,
      category: "release",
      severity: "medium",
      title: "Infrastructure files changed",
      detail: "Infra edits require staged rollout and rollback plan validation.",
      command: "terraform -chdir=infra/terraform fmt -check",
      artifactPointer: null,
      createdAt: now
    });
  }

  if (lowerPatch.includes("todo") || lowerPatch.includes("fixme")) {
    findings.push({
      id: createFindingId(),
      runId: run.id,
      category: "policy",
      severity: "low",
      title: "Patch contains TODO/FIXME markers",
      detail: "Patch includes TODO/FIXME markers. Confirm these are intentional.",
      command: null,
      artifactPointer: null,
      createdAt: now
    });
  }

  return findings;
}

function findingsFromCommandResults(runId: string, results: CommandExecution[], artifactPointer: string): ReviewFindingRecord[] {
  const now = new Date().toISOString();
  const findings: ReviewFindingRecord[] = [];
  for (const result of results) {
    if (result.code === 0) continue;
    const detail = topLine(`${result.stdout}\n${result.stderr}`) ?? "Command failed";
    findings.push({
      id: createFindingId(),
      runId,
      category: result.command.includes("lint") ? "lint" : "test",
      severity: "high",
      title: `Command failed: ${result.command}`,
      detail,
      command: result.command,
      artifactPointer,
      createdAt: now
    });
  }
  return findings;
}

export async function runAutomatedReview(input: ReviewExecutionInput): Promise<ReviewRecord> {
  const commands = input.commands && input.commands.length > 0 ? input.commands : inferDefaultCommands(input.run);
  const patch = fs.existsSync(input.run.patchPointer) ? fs.readFileSync(input.run.patchPointer, "utf8") : "";
  const commandResults: CommandExecution[] = [];

  for (const command of commands) {
    const result = await runCommand(command, input.repoRoot, 5 * 60 * 1000);
    commandResults.push({ command, ...result });
    if (result.code !== 0) {
      break;
    }
  }

  const reviewArtifact = input.store.artifactPath(`review-${input.run.id}.log`);
  const content = commandResults
    .map((result) => [`$ ${result.command}`, `exit=${result.code}`, result.stdout, result.stderr].join("\n"))
    .join("\n\n");
  fs.writeFileSync(reviewArtifact, content);

  const findings = [
    ...staticFindings(input.run, patch),
    ...findingsFromCommandResults(input.run.id, commandResults, path.resolve(reviewArtifact))
  ];
  const blocked = findings.some((finding) => finding.severity === "high" || finding.severity === "critical");
  const summary = blocked
    ? `Review failed with ${findings.length} findings (${findings.filter((f) => f.severity === "high" || f.severity === "critical").length} blocking).`
    : `Review passed with ${findings.length} findings.`;

  return input.store.createReview({
    runId: input.run.id,
    passed: !blocked,
    summary,
    commands,
    findings
  });
}
