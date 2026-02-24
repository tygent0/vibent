export type ProviderKind = "stub" | "openai-compatible" | "anthropic-compatible";

export interface ProviderConfig {
  kind: ProviderKind;
  model: string;
  apiBaseUrl?: string;
  apiKey?: string;
  maxAttempts: number;
  maxPatchChars: number;
  timeoutMs: number;
}

export interface PatchProposalInput {
  goal: string;
  existingDiff: string;
  changedFiles?: string[];
  scopeHints?: string[];
}

export interface PatchProposal {
  patch: string;
  provider: ProviderKind | "git-diff";
  attempts: number;
  notes: string[];
}

function readProviderConfig(): ProviderConfig {
  const kindRaw = (process.env.VIBENT_PROVIDER ?? "stub").trim().toLowerCase();
  const kind: ProviderKind =
    kindRaw === "openai-compatible" || kindRaw === "anthropic-compatible" ? kindRaw : "stub";
  const model =
    process.env.VIBENT_PROVIDER_MODEL ??
    (kind === "anthropic-compatible" ? "claude-3-5-sonnet-latest" : "gpt-4.1-mini");
  const maxAttempts = Math.min(10, Math.max(1, Number(process.env.VIBENT_PROVIDER_MAX_ATTEMPTS ?? 3)));
  const maxPatchChars = Math.min(1_000_000, Math.max(10_000, Number(process.env.VIBENT_PROVIDER_MAX_PATCH_CHARS ?? 200_000)));
  const timeoutMs = Math.min(10 * 60 * 1000, Math.max(10_000, Number(process.env.VIBENT_PROVIDER_TIMEOUT_MS ?? 120_000)));
  return {
    kind,
    model,
    apiBaseUrl: process.env.VIBENT_PROVIDER_API_BASE_URL,
    apiKey: process.env.VIBENT_PROVIDER_API_KEY,
    maxAttempts,
    maxPatchChars,
    timeoutMs
  };
}

function createStubPatch(goal: string): string {
  return [
    "diff --git a/.vibent/placeholder.txt b/.vibent/placeholder.txt",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/.vibent/placeholder.txt",
    "@@ -0,0 +1 @@",
    `+stub patch for goal: ${goal}`
  ].join("\n");
}

function normalizePatch(candidate: string, goal: string, maxPatchChars: number): string {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return createStubPatch(goal);
  }

  const patched = trimmed.includes("diff --git") ? trimmed : createStubPatch(goal);
  if (patched.length <= maxPatchChars) {
    return patched;
  }
  return `${patched.slice(0, maxPatchChars)}\n`;
}

function buildPrompt(input: PatchProposalInput): string {
  const changed = (input.changedFiles ?? []).slice(0, 30).join(", ");
  const scope = (input.scopeHints ?? []).slice(0, 10).join(", ");
  const contextLines = [
    "Return only a unified git diff. No markdown fences. No explanation.",
    `Goal: ${input.goal}`,
    changed ? `Changed files: ${changed}` : "",
    scope ? `Scope hints: ${scope}` : "",
    input.existingDiff.trim() ? `Current diff:\n${input.existingDiff}` : "Current diff is empty; propose minimal valid patch."
  ].filter(Boolean);
  return contextLines.join("\n\n");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function proposeWithOpenAiCompatible(input: PatchProposalInput, config: ProviderConfig): Promise<string> {
  if (!config.apiKey) {
    throw new Error("VIBENT_PROVIDER_API_KEY is required for openai-compatible provider");
  }
  const baseUrl = config.apiBaseUrl ?? "https://api.openai.com/v1";
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "You generate minimal valid unified git patches for local repositories."
          },
          { role: "user", content: buildPrompt(input) }
        ]
      })
    },
    config.timeoutMs
  );
  if (!response.ok) {
    throw new Error(`openai-compatible provider failed (${response.status})`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "";
}

async function proposeWithAnthropicCompatible(input: PatchProposalInput, config: ProviderConfig): Promise<string> {
  if (!config.apiKey) {
    throw new Error("VIBENT_PROVIDER_API_KEY is required for anthropic-compatible provider");
  }
  const baseUrl = config.apiBaseUrl ?? "https://api.anthropic.com";
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, "")}/v1/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        temperature: 0,
        messages: [{ role: "user", content: buildPrompt(input) }]
      })
    },
    config.timeoutMs
  );
  if (!response.ok) {
    throw new Error(`anthropic-compatible provider failed (${response.status})`);
  }
  const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  return json.content?.find((part) => part.type === "text")?.text ?? "";
}

export async function proposePatch(input: PatchProposalInput): Promise<PatchProposal> {
  if (input.existingDiff.trim().length > 0) {
    return {
      patch: input.existingDiff,
      provider: "git-diff",
      attempts: 1,
      notes: ["Using current git diff as patch proposal."]
    };
  }

  const config = readProviderConfig();
  const notes: string[] = [];
  let lastError = "";

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const rawCandidate =
        config.kind === "openai-compatible"
          ? await proposeWithOpenAiCompatible(input, config)
          : config.kind === "anthropic-compatible"
            ? await proposeWithAnthropicCompatible(input, config)
            : createStubPatch(input.goal);
      const patch = normalizePatch(rawCandidate, input.goal, config.maxPatchChars);
      notes.push(`Attempt ${attempt}: provider=${config.kind} produced ${patch.length} chars.`);
      return { patch, provider: config.kind, attempts: attempt, notes };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      notes.push(`Attempt ${attempt} failed: ${lastError}`);
    }
  }

  notes.push(`Fallback to stub patch: ${lastError || "provider unavailable"}`);
  return {
    patch: createStubPatch(input.goal),
    provider: "stub",
    attempts: config.maxAttempts,
    notes
  };
}
