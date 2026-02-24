export function filesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      files.push(line.replace("+++ b/", "").trim());
    }
  }
  return [...new Set(files)];
}

export function isWithinScope(files: string[], scopeHints: string[] | undefined): boolean {
  if (!scopeHints || scopeHints.length === 0) {
    return true;
  }

  return files.every((file) => scopeHints.some((scope) => file.startsWith(scope)));
}
