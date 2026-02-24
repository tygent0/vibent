"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";

export default function ConnectPage() {
  const [connected, setConnected] = useState<boolean | null>(null);

  const onConnect = async () => {
    const response = await fetch(`${API}/v1/mock/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connected: true })
    });
    const data = (await response.json()) as { connected: boolean };
    setConnected(data.connected);
  };

  return (
    <section>
      <h1>Connect Repos</h1>
      <p>Install the Vibent GitHub App and choose repositories. Local mode keeps this mocked.</p>
      <button onClick={onConnect}>Connect GitHub App</button>
      {connected !== null ? <p>{connected ? "Repos connected" : "Not connected"}</p> : null}
    </section>
  );
}
