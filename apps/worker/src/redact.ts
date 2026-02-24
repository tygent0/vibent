export function redact(input: string): string {
  return input
    .replace(/ghp_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
    .replace(/(?<=token=)[A-Za-z0-9\-_.]+/g, "[REDACTED]")
    .replace(/(?<=password=)[^\s]+/g, "[REDACTED]");
}
