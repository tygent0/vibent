import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { redact } from "./redact.js";

export interface VerifyInput {
  runId: string;
  commands: string[];
  cwd: string;
  artifactsDir: string;
}

export interface VerifyOutput {
  passed: boolean;
  summary: string;
  artifactPointer: string;
  highlights: Array<{ type: "failure" | "fix" | "next_step"; text: string }>;
}

function extractTopErrorLine(logs: string): string | null {
  const lines = logs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const match = lines.find((line) => /(error|failed|exception|ERR_)/i.test(line));
  return (match ?? lines[0] ?? "").slice(0, 200) || null;
}

async function runCommand(command: string, cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd, env: process.env });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

export async function executeVerification(input: VerifyInput): Promise<VerifyOutput> {
  fs.mkdirSync(input.artifactsDir, { recursive: true });

  const logs: string[] = [];
  let passed = true;

  for (const cmd of input.commands) {
    const result = await runCommand(cmd, input.cwd);
    logs.push(`$ ${cmd}\n${result.output}`);
    if (result.code !== 0) {
      passed = false;
      break;
    }
  }

  const cleanedLogs = redact(logs.join("\n\n"));
  const artifactPointer = path.join(input.artifactsDir, `${input.runId}.log`);
  fs.writeFileSync(artifactPointer, cleanedLogs);

  const topError = extractTopErrorLine(cleanedLogs);
  const highlights: VerifyOutput["highlights"] = passed
    ? [
        { type: "fix", text: `Verified: ${input.commands.join(", ")} passed.` },
        { type: "next_step", text: "Next: review changes and publish when ready." }
      ]
    : [
        { type: "failure", text: `Failed: ${input.commands.join(", ")}. ${topError ?? "See logs for details."}` },
        { type: "next_step", text: "Next: inspect failing output and rerun affected checks." }
      ];

  return {
    passed,
    summary: passed ? "Verification passed" : "Verification failed",
    artifactPointer,
    highlights
  };
}
