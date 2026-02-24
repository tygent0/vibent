"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";

interface CallbackSuccess {
  ok: boolean;
  connected: boolean;
  user: {
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string | null;
  };
}

interface CallbackError {
  error: string;
}

export default function SignInCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState<string>("Finishing GitHub sign-in...");

  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error_description") ?? params.get("error");

  const callbackUrl = useMemo(() => {
    const search = new URLSearchParams();
    if (code) search.set("code", code);
    if (state) search.set("state", state);
    return `${API}/v1/auth/github/callback?${search.toString()}`;
  }, [code, state]);

  useEffect(() => {
    if (oauthError) {
      setMessage(`GitHub sign-in failed: ${oauthError}`);
      return;
    }
    if (!code || !state) {
      setMessage("Missing OAuth callback parameters.");
      return;
    }

    const run = async () => {
      const response = await fetch(callbackUrl, { credentials: "include" });
      const data = (await response.json()) as CallbackSuccess | CallbackError;
      if (!response.ok || "error" in data) {
        setMessage(`Sign-in failed: ${"error" in data ? data.error : "unknown error"}`);
        return;
      }
      setMessage(`Signed in as @${data.user.login}. Redirecting...`);
      window.setTimeout(() => router.replace("/signin"), 700);
    };

    void run();
  }, [callbackUrl, code, oauthError, router, state]);

  return (
    <section>
      <h1>Sign in callback</h1>
      <p>{message}</p>
    </section>
  );
}
