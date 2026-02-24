export interface PublishPayload {
  runId: string;
  mode?: "pr" | "direct";
  prUrl?: string;
  prNumber?: number;
}

export async function connectApiMockGithub(connected: boolean): Promise<void> {
  const base = process.env.VIBENT_API_URL ?? "http://localhost:8080";
  await fetch(`${base}/v1/mock/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connected })
  });
}

export async function publishToApi(payload: PublishPayload): Promise<unknown> {
  const base = process.env.VIBENT_API_URL ?? "http://localhost:8080";
  const response = await fetch(`${base}/v1/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? "publish failed");
  }
  return data;
}
