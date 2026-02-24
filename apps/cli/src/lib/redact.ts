const secretPatterns = [
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /(?<=token=)[A-Za-z0-9\-_.]+/g,
  /(?<=password=)[^\s]+/g,
  /(?<=apikey=)[^\s]+/gi
];

export function redactSecrets(input: string, denylist: string[] = []): string {
  let output = input;
  for (const pattern of secretPatterns) {
    output = output.replace(pattern, "[REDACTED]");
  }
  for (const denied of denylist) {
    if (!denied) continue;
    output = output.split(denied).join("[REDACTED]");
  }
  return output;
}
