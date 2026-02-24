import { fetchJsonNoThrow, resolveApiBaseUrl } from "../../../lib/api";

interface Eval {
  id: string;
  summary: string;
  passed: boolean;
  commands: string[];
}

interface RunDetail {
  run: {
    id: string;
    goal: string;
    patchPointer: string;
    reproducibility: string;
    status: string;
  };
  evals: Eval[];
}

async function getRun(id: string): Promise<RunDetail | null> {
  const api = resolveApiBaseUrl();
  return await fetchJsonNoThrow<RunDetail>(`${api}/v1/runs/${id}`);
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getRun(id);

  if (!data) {
    return <p>Run not found.</p>;
  }

  return (
    <section>
      <h1>{data.run.goal}</h1>
      <div className="card">
        <p>
          <strong>Goal:</strong> {data.run.goal}
        </p>
        <p>
          <strong>Diff:</strong> <span className="mono">{data.run.patchPointer}</span>
        </p>
        <p>
          <strong>Results:</strong> {data.run.status}
        </p>
        <p>
          <strong>Reproduce:</strong> <span className="mono">vibent replay {data.run.id}</span>
        </p>
      </div>
      <h2>Tests</h2>
      {data.evals.map((evalResult) => (
        <div className="card" key={evalResult.id}>
          <p>
            <strong>{evalResult.passed ? "Passed" : "Failed"}</strong> - {evalResult.summary}
          </p>
          <p className="mono">{evalResult.commands.join(" | ")}</p>
        </div>
      ))}
    </section>
  );
}
