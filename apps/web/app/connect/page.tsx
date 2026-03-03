"use client";

import { useEffect, useMemo, useState } from "react";

const API = process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";

interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  owner: string;
  defaultBranch: string;
  htmlUrl: string;
  selected: boolean;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export default function ConnectPage() {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const selectedCount = useMemo(() => repos.filter((repo) => repo.selected).length, [repos]);

  const loadRepos = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    const response = await fetch(`${API}/v1/auth/github/repos`, {
      credentials: "include"
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setRepos([]);
      setError(data.error ?? "Could not load repositories. Sign in first.");
      setLoading(false);
      return;
    }
    const data = (await response.json()) as { repos: GithubRepo[] };
    setRepos(data.repos);
    setLoading(false);
  };

  const toggleRepo = (fullName: string) => {
    setRepos((prev) =>
      prev.map((repo) =>
        repo.fullName === fullName
          ? {
              ...repo,
              selected: !repo.selected
            }
          : repo
      )
    );
  };

  const saveSelection = async () => {
    const selected = repos.filter((repo) => repo.selected).map((repo) => repo.fullName);
    setSaving(true);
    setError("");
    setMessage("");
    const response = await fetch(`${API}/v1/auth/github/repos/select`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repos: selected })
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; selectedRepos?: string[] };
    if (!response.ok) {
      setSaving(false);
      setError(data.error ?? "Could not save selected repositories.");
      return;
    }
    const selectedSet = new Set(data.selectedRepos ?? selected);
    setRepos((prev) => prev.map((repo) => ({ ...repo, selected: selectedSet.has(repo.fullName) })));
    setSaving(false);
    setMessage(`Saved ${selectedSet.size} selected repos.`);
  };

  useEffect(() => {
    void loadRepos();
  }, []);

  return (
    <section>
      <h1>Connect Repos</h1>
      <p>Select one or more repositories available to your signed-in GitHub account.</p>
      <button onClick={() => void loadRepos()} disabled={loading}>
        {loading ? "Loading..." : "Refresh Repositories"}
      </button>
      {error ? <p>{error}</p> : null}
      {message ? <p>{message}</p> : null}

      {!loading && repos.length > 0 ? (
        <div className="card">
          <p>
            {selectedCount} selected / {repos.length} available
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {repos.map((repo) => (
              <label key={repo.id} style={{ display: "grid", gap: 4 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={repo.selected}
                    onChange={() => toggleRepo(repo.fullName)}
                  />
                  <strong>{repo.fullName}</strong>
                  <span className="status">{repo.private ? "private" : "public"}</span>
                </span>
                <span className="mono">
                  default branch: {repo.defaultBranch} | perms: {repo.permissions.push ? "write" : "read"}
                </span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button onClick={() => void saveSelection()} disabled={saving || selectedCount === 0}>
              {saving ? "Saving..." : "Save Selection"}
            </button>
            <span>{selectedCount === 0 ? "Select at least one repository." : ""}</span>
          </div>
        </div>
      ) : null}

      {!loading && repos.length === 0 && !error ? <p>No repositories found for this account.</p> : null}
    </section>
  );
}
