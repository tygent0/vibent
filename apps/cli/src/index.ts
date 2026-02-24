import { Command } from "commander";
import { agentServeCommandHandler } from "./commands/agentServe.js";
import { blameCommandHandler } from "./commands/blame.js";
import { publishCommandHandler } from "./commands/publish.js";
import {
  releaseCreateCommandHandler,
  releaseListCommandHandler,
  releasePromoteCommandHandler,
  releaseRollbackCommandHandler
} from "./commands/release.js";
import { replayCommandHandler } from "./commands/replay.js";
import { reviewCommandHandler } from "./commands/review.js";
import { runCommandHandler } from "./commands/run.js";
import {
  sessionArchiveCommandHandler,
  sessionContinueCommandHandler,
  sessionListCommandHandler,
  sessionNoteCommandHandler,
  sessionPinCommandHandler,
  sessionShowCommandHandler,
  sessionStartCommandHandler,
  sessionStatusCommandHandler
} from "./commands/session.js";
import { signalAddCommandHandler, signalListCommandHandler } from "./commands/signal.js";
import { verifyCommandHandler } from "./commands/verify.js";
import { getRepoRoot } from "./lib/git.js";
import { connectApiMockGithub } from "./lib/http.js";
import { LocalStore } from "./lib/store.js";

const program = new Command();

program.name("vibent").description("Developer-joy-first evidence for AI coding").version("0.1.0");

program
  .command("run")
  .argument("<goal>")
  .description("Record a run with a goal and stub patch")
  .action(async (goal: string) => {
    await runCommandHandler(goal);
  });

program
  .command("verify")
  .argument("[run_id]")
  .description("Run targeted local checks and store evidence")
  .action(async (runId?: string) => {
    await verifyCommandHandler(runId);
  });

program
  .command("publish")
  .argument("[run_id]")
  .option("--pr <pr>", "PR number or URL")
  .option("--mode <mode>", "Publish mode: pr or direct", "pr")
  .description("Publish Vibent Evidence check and rolling PR comment")
  .action(async (runId: string | undefined, options: { pr?: string; mode?: string }) => {
    await publishCommandHandler(runId, options.pr, options.mode);
  });

program
  .command("review")
  .argument("[run_id]")
  .option("--command <command...>", "Review command(s) to execute")
  .description("Run automated review and security checks")
  .action(async (runId: string | undefined, options: { command?: string[] }) => {
    await reviewCommandHandler(runId, options.command);
  });

program
  .command("blame")
  .argument("<pathLine>", "path:line")
  .description("Show git blame with vibent run context")
  .action(async (target: string) => {
    await blameCommandHandler(target);
  });

program
  .command("replay")
  .argument("<run_id>")
  .option("--with-session", "continue linked session before replay")
  .description("Replay run in clean workspace and rerun checks")
  .action(async (runId: string, options: { withSession?: boolean }) => {
    await replayCommandHandler(runId, { withSession: options.withSession });
  });

program
  .command("agent")
  .description("Agent daemon commands")
  .command("serve")
  .description("Start local daemon for coding agents")
  .action(async () => {
    await agentServeCommandHandler();
  });

const release = program.command("release").description("Release rollout commands");

release
  .command("create")
  .argument("[run_id]")
  .option("--env <environment>", "Target environment", "dev")
  .option("--traffic <percent>", "Initial traffic percentage", "10")
  .option("--notes <notes>", "Release notes")
  .description("Create a release from a reviewed run")
  .action(async (runId: string | undefined, options: { env?: string; traffic?: string; notes?: string }) => {
    await releaseCreateCommandHandler({
      runId,
      environment: options.env,
      trafficPercent: Number(options.traffic ?? "10"),
      notes: options.notes
    });
  });

release
  .command("promote")
  .argument("<release_id>")
  .option("--traffic <percent>", "Traffic percentage target", "100")
  .description("Promote release traffic")
  .action(async (releaseId: string, options: { traffic?: string }) => {
    await releasePromoteCommandHandler(releaseId, Number(options.traffic ?? "100"));
  });

release
  .command("rollback")
  .argument("<release_id>")
  .option("--reason <reason>", "Rollback reason", "manual rollback")
  .description("Roll back a release")
  .action(async (releaseId: string, options: { reason?: string }) => {
    await releaseRollbackCommandHandler(releaseId, options.reason);
  });

release
  .command("list")
  .argument("[run_id]")
  .description("List releases")
  .action(async (runId?: string) => {
    await releaseListCommandHandler(runId);
  });

const signal = program.command("signal").description("Production signal commands");

signal
  .command("add")
  .requiredOption("--type <type>", "Signal type")
  .requiredOption("--severity <severity>", "Severity: info|warning|critical")
  .requiredOption("--summary <summary>", "Human-readable signal summary")
  .option("--session <session_id>", "Session ID")
  .option("--run <run_id>", "Run ID")
  .option("--source <source>", "Signal source", "manual")
  .option("--value <metric_value>", "Numeric metric value")
  .option("--unit <unit>", "Metric unit")
  .description("Ingest a production signal")
  .action(
    async (options: {
      session?: string;
      run?: string;
      source?: string;
      type: "error_rate" | "latency" | "availability" | "rollback" | "cost" | "throughput";
      severity: "info" | "warning" | "critical";
      summary: string;
      value?: string;
      unit?: string;
    }) => {
      await signalAddCommandHandler({
        sessionId: options.session,
        runId: options.run,
        source: options.source,
        type: options.type,
        severity: options.severity,
        summary: options.summary,
        metricValue: options.value ? Number(options.value) : undefined,
        unit: options.unit
      });
    }
  );

signal
  .command("list")
  .option("--session <session_id>", "Session ID")
  .option("--run <run_id>", "Run ID")
  .option("--limit <count>", "Number of signals", "20")
  .description("List production signals")
  .action(async (options: { session?: string; run?: string; limit?: string }) => {
    await signalListCommandHandler({
      sessionId: options.session,
      runId: options.run,
      limit: Number(options.limit ?? "20")
    });
  });

program
  .command("login")
  .description("Mark local workspace as GitHub-connected")
  .action(async () => {
    const repoRoot = await getRepoRoot(process.cwd());
    const store = new LocalStore(repoRoot);
    store.setGithubConnected(true);
    await connectApiMockGithub(true);
    console.log("GitHub connection enabled locally");
  });

const session = program.command("session").description("Session memory commands");

session
  .command("start")
  .option("--title <title>", "Session title")
  .option("--from <from>", "Source branch, PR, or run_id")
  .description("Start a session")
  .action(async (options: { title?: string; from?: string }) => {
    await sessionStartCommandHandler(options);
  });

session
  .command("status")
  .description("Show active session summary and next steps")
  .action(async () => {
    await sessionStatusCommandHandler();
  });

session
  .command("list")
  .option("--query <query>", "Search sessions")
  .description("List recent sessions")
  .action(async (options: { query?: string }) => {
    await sessionListCommandHandler(options);
  });

session
  .command("show")
  .argument("<session_id>")
  .description("Show session highlights, runs, notes, and resume tasks")
  .action(async (sessionId: string) => {
    await sessionShowCommandHandler(sessionId);
  });

session
  .command("note")
  .argument("<text>")
  .description("Add a quick note to the active session")
  .action(async (text: string) => {
    await sessionNoteCommandHandler(text);
  });

session
  .command("continue")
  .argument("[session_id]")
  .description("Continue active session or select one")
  .action(async (sessionId?: string) => {
    await sessionContinueCommandHandler(sessionId);
  });

session
  .command("archive")
  .argument("<session_id>")
  .description("Archive session")
  .action(async (sessionId: string) => {
    await sessionArchiveCommandHandler(sessionId);
  });

session
  .command("pin")
  .argument("<session_id>")
  .option("--off", "Disable pin")
  .description("Pin or unpin session for extended retention")
  .action(async (sessionId: string, options: { off?: boolean }) => {
    await sessionPinCommandHandler(sessionId, !options.off);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
