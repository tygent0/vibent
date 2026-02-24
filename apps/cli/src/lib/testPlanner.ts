import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import YAML from "yaml";

interface Mapping {
  glob: string;
  commands: string[];
}

interface TestMap {
  mappings?: Mapping[];
}

function loadMap(repoRoot: string): TestMap {
  const file = path.join(repoRoot, ".vibent", "testmap.yaml");
  if (!fs.existsSync(file)) {
    return {};
  }
  return (YAML.parse(fs.readFileSync(file, "utf8")) as TestMap) ?? {};
}

export function planCommands(repoRoot: string, changedFiles: string[]): string[] {
  const map = loadMap(repoRoot);
  const selected = new Set<string>();

  for (const item of map.mappings ?? []) {
    const matched = fg.globSync(item.glob, { cwd: repoRoot }).some((p) => changedFiles.includes(p));
    if (matched) {
      for (const command of item.commands) selected.add(command);
    }
  }

  if (selected.size > 0) {
    return [...selected];
  }

  if (changedFiles.some((f) => f.startsWith("apps/web/") || f.startsWith("frontend/"))) {
    return ["pnpm --filter @vibent/web lint", "pnpm --filter @vibent/web test"];
  }

  if (changedFiles.some((f) => f.startsWith("apps/api/") || f.startsWith("apps/worker/") || f.startsWith("backend/"))) {
    return ["pnpm --filter @vibent/api test", "pnpm --filter @vibent/worker test"];
  }

  return ["pnpm test"];
}
