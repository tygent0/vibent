import Link from "next/link";
import { fetchJsonNoThrow, resolveApiBaseUrl } from "../../lib/api";

interface Run {
  id: string;
  goal: string;
  status: "Draft" | "Verified" | "Published";
  createdAt: string;
}

async function getRuns(): Promise<Run[]> {
  const api = resolveApiBaseUrl();
  const data = await fetchJsonNoThrow<{ runs: Run[] }>(`${api}/v1/runs`);
  return data?.runs ?? [];
}

export default async function RunsPage() {
  const runs = await getRuns();

  return (
    <section>
      <h1>Runs</h1>
      {runs.length === 0 ? <p>No runs yet. Start with `vibent run "..."`.</p> : null}
      {runs.map((run) => (
        <div className="card" key={run.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{run.goal}</strong>
            <span className="status">{run.status}</span>
          </div>
          <p className="mono">{run.id}</p>
          <p>{new Date(run.createdAt).toLocaleString()}</p>
          <Link href={`/runs/${run.id}`}>View run</Link>
        </div>
      ))}
    </section>
  );
}
