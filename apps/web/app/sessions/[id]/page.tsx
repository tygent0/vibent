import { fetchJsonNoThrow, resolveApiBaseUrl } from "../../../lib/api";

export const dynamic = "force-dynamic";

interface SessionDetail {
  session: {
    id: string;
    title: string;
    status: "active" | "archived";
    lastActiveAt: string;
  };
  runs: Array<{
    id: string;
    goal: string;
    status: "Draft" | "Verified" | "Published";
    createdAt: string;
  }>;
  highlights: Array<{
    id: string;
    type: string;
    text: string;
  }>;
  notes: Array<{
    id: string;
    ts: string;
    payload: { text?: string };
  }>;
  signals: Array<{
    id: string;
    severity: "info" | "warning" | "critical";
    type: string;
    summary: string;
    createdAt: string;
  }>;
  releases: Array<{
    id: string;
    runId: string;
    environment: string;
    status: string;
    trafficPercent: number;
    version: string;
    updatedAt: string;
  }>;
  resume: {
    tasks: string[];
    suggestedCommands: string[];
    risks: string[];
  };
  changedSinceLastKnownGood: string[];
}

async function getSessionDetail(id: string): Promise<SessionDetail | null> {
  const api = resolveApiBaseUrl();
  return await fetchJsonNoThrow<SessionDetail>(`${api}/v1/sessions/${id}`);
}

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getSessionDetail(id);

  if (!data) {
    return <p>Session not found.</p>;
  }

  return (
    <section>
      <h1>{data.session.title}</h1>
      <div className="card">
        <p>
          <strong>Session:</strong> <span className="mono">{data.session.id}</span>
        </p>
        <p>
          <strong>Status:</strong> {data.session.status}
        </p>
        <p>
          <strong>Last active:</strong> {new Date(data.session.lastActiveAt).toLocaleString()}
        </p>
      </div>

      <h2>Highlights</h2>
      {data.highlights.length === 0 ? <p>No highlights yet.</p> : null}
      {data.highlights.slice(0, 10).map((highlight) => (
        <div className="card" key={highlight.id}>
          <p>
            <strong>{highlight.type}</strong>
          </p>
          <p>{highlight.text}</p>
        </div>
      ))}

      <h2>Resume</h2>
      <div className="card">
        {data.resume.tasks.length === 0 ? <p>No next steps yet.</p> : null}
        {data.resume.tasks.map((task) => (
          <p key={task}>- {task}</p>
        ))}
        {data.resume.suggestedCommands.length > 0 ? <p className="mono">Commands:</p> : null}
        {data.resume.suggestedCommands.map((command) => (
          <p className="mono" key={command}>
            {command}
          </p>
        ))}
      </div>

      <h2>Runs</h2>
      {data.runs.length === 0 ? <p>No runs linked yet.</p> : null}
      {data.runs.map((run) => (
        <div className="card" key={run.id}>
          <p>
            <strong>{run.goal}</strong>
          </p>
          <p>
            <span className="status">{run.status}</span>
          </p>
          <p className="mono">{run.id}</p>
          <p>{new Date(run.createdAt).toLocaleString()}</p>
        </div>
      ))}

      <h2>Notes</h2>
      {data.notes.length === 0 ? <p>No notes yet.</p> : null}
      {data.notes.map((note) => (
        <div className="card" key={note.id}>
          <p>{note.payload.text ?? ""}</p>
          <p>{new Date(note.ts).toLocaleString()}</p>
        </div>
      ))}

      <h2>Production Signals</h2>
      {data.signals.length === 0 ? <p>No production signals yet.</p> : null}
      {data.signals.map((signal) => (
        <div className="card" key={signal.id}>
          <p>
            <strong>
              {signal.severity} {signal.type}
            </strong>
          </p>
          <p>{signal.summary}</p>
          <p>{new Date(signal.createdAt).toLocaleString()}</p>
        </div>
      ))}

      <h2>Releases</h2>
      {data.releases.length === 0 ? <p>No releases yet.</p> : null}
      {data.releases.map((release) => (
        <div className="card" key={release.id}>
          <p>
            <strong>{release.id}</strong>
          </p>
          <p>
            {release.environment} | {release.status} | {release.trafficPercent}% traffic
          </p>
          <p className="mono">{release.version}</p>
          <p>{new Date(release.updatedAt).toLocaleString()}</p>
        </div>
      ))}

      <h2>What Changed Since Last Known Good</h2>
      <div className="card">
        {data.changedSinceLastKnownGood.length === 0 ? <p>No changes since last known good.</p> : null}
        {data.changedSinceLastKnownGood.map((file) => (
          <p className="mono" key={file}>
            {file}
          </p>
        ))}
      </div>
    </section>
  );
}
