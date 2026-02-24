import crypto from "node:crypto";

export interface RunManifestInput {
  goal: string;
  baseRef: string;
  baseSha: string;
  patchPointer: string;
  reproducibility: "replayable-locally" | "server-only";
}

export function hashRunManifest(input: RunManifestInput): string {
  const normalized = JSON.stringify(input, Object.keys(input).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
