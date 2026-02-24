import { buildResumePlan, buildSnapshot } from "../lib/memory.js";
import { getHeadSha, getRepoRoot } from "../lib/git.js";
import { LocalStore, SessionRecord } from "../lib/store.js";

function resolveSessionFromArg(store: LocalStore, sessionIdArg?: string): SessionRecord | null {
  if (sessionIdArg) {
    return store.getSession(sessionIdArg);
  }
  return store.getActiveSession() ?? store.listSessions({ includeArchived: false })[0] ?? null;
}

function changedSinceLastKnownGood(store: LocalStore, session: SessionRecord): string[] {
  const snapshot = store.latestSnapshot(session.id);
  if (!snapshot?.lastKnownGood) return [];

  const runs = store.listRunsForSession(session.id);
  const files = new Set<string>();
  for (const run of runs) {
    if (run.id === snapshot.lastKnownGood) break;
    for (const file of run.changedFiles) {
      files.add(file);
    }
  }
  return [...files].slice(0, 12);
}

export async function sessionStartCommandHandler(options: { title?: string; from?: string }): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const headSha = await getHeadSha(repoRoot);
  const title = options.title?.trim() || "Session";

  const session = store.createSession({
    title,
    branchRef: options.from ?? null,
    summary: `Started at ${headSha.slice(0, 8)}`
  });

  store.createEvent({
    sessionId: session.id,
    type: "decision",
    payload: {
      text: `Session started: ${title}`,
      rationale_short: "Manual session start"
    }
  });

  if (options.from) {
    const runFromArg = store.getRun(options.from);
    if (runFromArg) {
      store.linkRunToSession(runFromArg.id, session.id);
      store.createEvent({
        sessionId: session.id,
        runId: runFromArg.id,
        type: "link",
        payload: { runId: runFromArg.id, from: options.from }
      });
    }
  }

  buildSnapshot(store, session, "Session started", process.env);
  buildResumePlan(store, session);

  console.log(`Session: ${session.id}`);
  console.log(`Title: ${session.title}`);
  console.log("Status: active");
}

export async function sessionStatusCommandHandler(): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const session = store.getActiveSession();
  if (!session) {
    console.log("No active session. Start one with: vibent session start --title \"...\"");
    return;
  }

  const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session);
  const highlights = store.listHighlights(session.id, 5);
  const changedFiles = changedSinceLastKnownGood(store, session);
  const signals = store.listSignals({ sessionId: session.id, limit: 5 });

  console.log(`Session: ${session.id}`);
  console.log(`Title: ${session.title}`);
  console.log(`Last active: ${session.lastActiveAt}`);
  console.log(`Linked runs: ${session.linkedRuns.length}`);

  if (highlights.length > 0) {
    console.log("Highlights:");
    for (const highlight of highlights) {
      console.log(`- [${highlight.type}] ${highlight.text}`);
    }
  }

  if (resume.tasks.length > 0) {
    console.log("Resume:");
    for (const task of resume.tasks) {
      console.log(`- ${task}`);
    }
  }

  if (resume.suggestedCommands.length > 0) {
    console.log("Commands:");
    for (const cmd of resume.suggestedCommands) {
      console.log(`- ${cmd}`);
    }
  }

  if (changedFiles.length > 0) {
    console.log("What changed since last known good:");
    for (const file of changedFiles) {
      console.log(`- ${file}`);
    }
  }

  if (signals.length > 0) {
    console.log("Production signals:");
    for (const signal of signals) {
      console.log(`- [${signal.severity}] ${signal.type}: ${signal.summary}`);
    }
  }
}

export async function sessionListCommandHandler(options: { query?: string }): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const sessions = store.listSessions({ includeArchived: true, query: options.query });

  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  const activeId = store.getActiveSessionId();
  for (const session of sessions) {
    const marker = session.id === activeId ? "*" : " ";
    console.log(
      `${marker} ${session.id} | ${session.status} | ${session.lastActiveAt} | ${session.title} | runs=${session.linkedRuns.length}`
    );
  }
}

export async function sessionShowCommandHandler(sessionId: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const session = store.getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const runs = store.listRunsForSession(session.id);
  const highlights = store.listHighlights(session.id, 10);
  const notes = store.listSessionEvents(session.id, { type: "note", limit: 20 });
  const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session);
  const changedFiles = changedSinceLastKnownGood(store, session);
  const signals = store.listSignals({ sessionId: session.id, limit: 10 });

  console.log(`${session.title} (${session.id})`);
  console.log(`Status: ${session.status}`);
  console.log(`Pinned: ${session.pinned ? "yes" : "no"}`);
  console.log(`Last active: ${session.lastActiveAt}`);

  if (highlights.length > 0) {
    console.log("Highlights:");
    for (const highlight of highlights) {
      console.log(`- [${highlight.type}] ${highlight.text}`);
    }
  }

  if (runs.length > 0) {
    console.log("Runs:");
    for (const run of runs.slice(0, 10)) {
      console.log(`- ${run.id} | ${run.status} | ${run.goal}`);
    }
  }

  if (resume.tasks.length > 0 || resume.suggestedCommands.length > 0) {
    console.log("Resume:");
    for (const task of resume.tasks) {
      console.log(`- ${task}`);
    }
    for (const cmd of resume.suggestedCommands) {
      console.log(`- ${cmd}`);
    }
  }

  if (notes.length > 0) {
    console.log("Notes:");
    for (const note of notes) {
      const text = String(note.payload.text ?? "");
      console.log(`- ${note.ts}: ${text}`);
    }
  }

  if (changedFiles.length > 0) {
    console.log("What changed since last known good:");
    for (const file of changedFiles) {
      console.log(`- ${file}`);
    }
  }

  if (signals.length > 0) {
    console.log("Production signals:");
    for (const signal of signals) {
      console.log(`- [${signal.severity}] ${signal.type}: ${signal.summary}`);
    }
  }
}

export async function sessionNoteCommandHandler(text: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const session = store.getActiveSession();
  if (!session) {
    throw new Error("No active session. Start one with vibent session start.");
  }

  store.addNote(session.id, text);
  store.createHighlight({
    sessionId: session.id,
    type: "finding",
    text: `Note: ${text}`
  });
  buildSnapshot(store, session, "Added note", process.env);
  buildResumePlan(store, session);

  console.log(`Saved note to ${session.id}`);
}

export async function sessionContinueCommandHandler(sessionIdArg?: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const resolved = resolveSessionFromArg(store, sessionIdArg);
  if (!resolved) {
    throw new Error("No session to continue");
  }

  const session = store.continueSession(resolved.id);
  if (!session) {
    throw new Error("Session is archived. Start a new session or unarchive first.");
  }

  const resume = store.latestResumePlan(session.id) ?? buildResumePlan(store, session);
  console.log(`Active session: ${session.id}`);
  if (resume.tasks.length > 0) {
    console.log("Next steps:");
    for (const task of resume.tasks) {
      console.log(`- ${task}`);
    }
  }
}

export async function sessionArchiveCommandHandler(sessionId: string): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const session = store.archiveSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  console.log(`Archived session ${session.id}`);
}

export async function sessionPinCommandHandler(sessionId: string, pinned: boolean): Promise<void> {
  const repoRoot = await getRepoRoot(process.cwd());
  const store = new LocalStore(repoRoot);
  const session = store.pinSession(sessionId, pinned);
  if (!session) {
    throw new Error("Session not found");
  }

  console.log(`${pinned ? "Pinned" : "Unpinned"} session ${session.id}`);
}
