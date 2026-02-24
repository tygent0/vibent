import { fetchJsonNoThrow, resolveApiBaseUrl } from "../../lib/api";

export const dynamic = "force-dynamic";

interface SessionItem {
  id: string;
  title: string;
  status: "active" | "archived";
  lastActiveAt: string;
  linkedRuns: string[];
}

async function getSessions(): Promise<SessionItem[]> {
  const api = resolveApiBaseUrl();
  const data = await fetchJsonNoThrow<{ sessions: SessionItem[] }>(`${api}/v1/sessions`);
  return data?.sessions ?? [];
}

export default async function SessionsPage() {
  const sessions = await getSessions();

  return (
    <section>
      <h1>Sessions</h1>
      {sessions.length === 0 ? <p>No sessions yet. Start with `vibent session start`.</p> : null}
      {sessions.map((session) => (
        <div className="card" key={session.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{session.title}</strong>
            <span className="status">{session.status}</span>
          </div>
          <p className="mono">{session.id}</p>
          <p>Last active: {new Date(session.lastActiveAt).toLocaleString()}</p>
          <p>Runs: {session.linkedRuns.length}</p>
          <a href={`/sessions/${session.id}`}>Open session</a>
        </div>
      ))}
    </section>
  );
}
