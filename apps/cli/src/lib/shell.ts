import { spawn } from "node:child_process";

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(command: string, cwd: string, timeoutMs = 10 * 60 * 1000): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
