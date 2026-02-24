import path from "node:path";

export interface ApiConfig {
  port: number;
  host: string;
  githubWebhookSecret: string;
  dataDir: string;
  artifactsDir: string;
  mockGithub: boolean;
}

export function loadConfig(): ApiConfig {
  const cwd = process.cwd();
  return {
    port: Number(process.env.API_PORT ?? 8080),
    host: process.env.API_HOST ?? "0.0.0.0",
    githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "dev-secret",
    dataDir: process.env.VIBENT_DATA_DIR ?? path.join(cwd, "data"),
    artifactsDir: process.env.VIBENT_ARTIFACTS_DIR ?? path.join(cwd, "artifacts"),
    mockGithub: (process.env.VIBENT_MOCK_GITHUB ?? "true") === "true"
  };
}
