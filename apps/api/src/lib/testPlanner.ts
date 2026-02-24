import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import YAML from "yaml";

interface TestMapFile {
  mappings?: Array<{ glob: string; commands: string[] }>;
}

function readTestMap(repoRoot: string): TestMapFile {
  const filePath = path.join(repoRoot, ".vibent", "testmap.yaml");
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const parsed = YAML.parse(fs.readFileSync(filePath, "utf8")) as TestMapFile;
  return parsed ?? {};
}

export function suggestCommands(changedFiles: string[], repoRoot: string): string[] {
  const testMap = readTestMap(repoRoot);
  const commands = new Set<string>();

  for (const mapping of testMap.mappings ?? []) {
    const matches = fg.isDynamicPattern(mapping.glob)
      ? fg.globSync(mapping.glob, { cwd: repoRoot }).filter((f) => changedFiles.includes(f)).length > 0
      : changedFiles.includes(mapping.glob);

    if (matches) {
      for (const cmd of mapping.commands) commands.add(cmd);
    }
  }

  if (commands.size > 0) {
    return [...commands];
  }

  if (changedFiles.some((file) => file.startsWith("frontend/") || file.startsWith("apps/web/"))) {
    return ["pnpm --filter @vibent/web test", "pnpm --filter @vibent/web lint"];
  }
  if (changedFiles.some((file) => file.startsWith("backend/") || file.startsWith("apps/api/") || file.startsWith("apps/worker/"))) {
    return ["pnpm --filter @vibent/api test", "pnpm --filter @vibent/worker test"];
  }
  return ["pnpm test --filter @vibent/*"];
}
