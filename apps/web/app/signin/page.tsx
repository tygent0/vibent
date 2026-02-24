"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";

export default function SignInPage() {
  const [message, setMessage] = useState<string>("");

  const connect = async () => {
    const res = await fetch(`${API}/v1/mock/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connected: true })
    });
    const data = (await res.json()) as { connected: boolean };
    setMessage(data.connected ? "Connected to GitHub (mock mode)." : "Connection failed.");
  };

  return (
    <section>
      <h1>Sign in with GitHub</h1>
      <p>OAuth flow is mocked locally so you can test the full path without GitHub setup.</p>
      <button onClick={connect}>Sign in</button>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
