export function resolveApiBaseUrl(): string {
  return process.env.VIBENT_API_URL ?? process.env.NEXT_PUBLIC_VIBENT_API_URL ?? "http://localhost:8080";
}

export async function fetchJsonNoThrow<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch (error) {
    console.error(`Failed to fetch ${url}`, error);
    return null;
  }
}
