const DEFAULT_BASE_URL = "https://ollama.com/api";
const DEFAULT_TIMEOUT_MS = 180_000;

export type OllamaStructuredRequest = {
  system: string;
  user: unknown;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
};

export function ollamaCloudStatus() {
  return {
    configured: Boolean(process.env.OLLAMA_API_KEY && process.env.OLLAMA_MODEL),
    baseUrl: normalizedBaseUrl(),
    model: process.env.OLLAMA_MODEL || null,
    concurrency: 1,
  };
}

export async function runOllamaCloudStructuredPass<T>({
  system,
  user,
  schema,
  temperature = 0.2,
  maxTokens = 750,
}: OllamaStructuredRequest): Promise<T> {
  const apiKey = process.env.OLLAMA_API_KEY;
  const model = process.env.OLLAMA_MODEL;
  if (!apiKey || !model) throw new OllamaCloudError("Ollama Cloud is not configured.");
  const timeoutMs = positiveInteger(process.env.OLLAMA_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const response = await fetch(new URL("chat", `${normalizedBaseUrl()}/`), {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      options: { temperature, num_predict: maxTokens },
      // The hosted Gemma cloud model currently honors JSON mode reliably but
      // may ignore an inline JSON Schema and return plain text. Validation
      // below the transport remains authoritative, so send the schema in the
      // instruction and require JSON mode here.
      format: "json",
      messages: [
        {
          role: "system",
          content: `${system}\nReturn only JSON matching this schema exactly:\n${JSON.stringify(schema)}`,
        },
        { role: "user", content: JSON.stringify(user) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new OllamaCloudError(`Ollama Cloud request failed (${response.status}).`);
  const body = await response.json() as { message?: { content?: string } };
  const content = body.message?.content;
  if (!content) throw new OllamaCloudError("Ollama Cloud returned no structured content.");
  try {
    return JSON.parse(stripJsonFence(content)) as T;
  } catch {
    throw new OllamaCloudError("Ollama Cloud returned invalid structured JSON.");
  }
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function normalizedBaseUrl(): string {
  return String(process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

export class OllamaCloudError extends Error {}
