import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const app = createApp();
  const config = loadConfig();

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ port: config.port }, "vibent-api started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
