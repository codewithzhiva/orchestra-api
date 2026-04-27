import { z } from "zod";

export const HttpNodeConfig = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().optional(),
  timeoutMs: z.number().min(100).max(30_000).default(10_000),
});

export type HttpNodeConfigT = z.infer<typeof HttpNodeConfig>;

export async function runHttpNode(
  config: HttpNodeConfigT,
  rendered: { url: string; body?: string },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const res = await fetch(rendered.url, {
      method: config.method,
      headers: {
        "Content-Type": "application/json",
        ...(config.headers ?? {}),
      },
      body: config.method !== "GET" && rendered.body ? rendered.body : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    // Try to return pretty-printed JSON, fall back to raw text
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}
