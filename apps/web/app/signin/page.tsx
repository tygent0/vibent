"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";

interface SessionResponse {
  connected: boolean;
  user: {
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
}

export default function SignInPage() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [message, setMessage] = useState<string>("");

  const loadSession = async () => {
    const response = await fetch(`${API}/v1/auth/session`, { credentials: "include" });
    if (!response.ok) {
      setSession(null);
      return;
    }
    const data = (await response.json()) as SessionResponse;
    setSession(data);
  };

  useEffect(() => {
    void loadSession();
  }, []);

  const startSignIn = () => {
    const returnTo = `${window.location.origin}/signin/callback`;
    window.location.href = `${API}/v1/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;
  };

  const signOut = async () => {
    const response = await fetch(`${API}/v1/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
    if (!response.ok) {
      setMessage("Sign out failed.");
      return;
    }
    setMessage("Signed out.");
    await loadSession();
  };

  return (
    <section>
      <h1>Sign in with GitHub</h1>
      <p>Uses real GitHub OAuth. Configure `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the API env.</p>
      {session?.connected && session.user ? <p>Signed in as @{session.user.login}</p> : <p>Not signed in.</p>}
      <button onClick={startSignIn}>Sign in</button>
      <button onClick={signOut}>Sign out</button>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
