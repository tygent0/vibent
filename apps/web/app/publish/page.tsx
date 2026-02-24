"use client";

import { FormEvent, useState } from "react";

const API = process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";

export default function PublishPage() {
  const [runId, setRunId] = useState("");
  const [pr, setPr] = useState("");
  const [mode, setMode] = useState<"pr" | "direct">("pr");
  const [result, setResult] = useState("");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const prNum = Number(pr);
    const payload: { runId: string; mode: "pr" | "direct"; prNumber?: number; prUrl?: string } = { runId, mode };
    if (mode === "pr") {
      if (!Number.isNaN(prNum) && prNum > 0) {
        payload.prNumber = prNum;
      } else if (pr.trim()) {
        payload.prUrl = pr.trim();
      }
    }

    const response = await fetch(`${API}/v1/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await response.json()) as { error?: string };
    setResult(response.ok ? "Evidence published." : data.error ?? "Publish failed.");
  };

  return (
    <section>
      <h1>Publish Evidence</h1>
      <form onSubmit={onSubmit} className="card">
        <label>
          Run ID
          <input
            value={runId}
            onChange={(e) => setRunId(e.currentTarget.value)}
            placeholder="run_xxx"
            required
          />
        </label>
        <label>
          Publish mode
          <select value={mode} onChange={(e) => setMode(e.currentTarget.value as "pr" | "direct")}>
            <option value="pr">PR mode (check + rolling comment)</option>
            <option value="direct">Direct mode (no PR required)</option>
          </select>
        </label>
        {mode === "pr" ? (
          <label>
            PR URL or number
            <input
              value={pr}
              onChange={(e) => setPr(e.currentTarget.value)}
              placeholder="123 or https://github.com/..."
            />
          </label>
        ) : null}
        <button type="submit">Publish Evidence</button>
      </form>
      {result ? <p>{result}</p> : null}
    </section>
  );
}
