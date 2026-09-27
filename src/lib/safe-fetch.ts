// Outbound GET with an origin allowlist, timeout, response size cap and no redirect following.

export interface SafeFetchOptions {
  allowedOrigins: string[];
  timeoutMs: number;
  maxBytes: number;
}

export type SafeFetchResult =
  | {
      kind: "response";
      status: number;
      statusText: string;
      ok: boolean;
      contentType: string;
      body: string;
      json: unknown | undefined;
      truncated: boolean;
      durationMs: number;
      redirectLocation?: string;
    }
  | { kind: "blocked" | "timeout" | "network_error"; message: string; durationMs: number };

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);
}

export function defaultOptions(): SafeFetchOptions {
  return {
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_API_ORIGINS),
    timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 5000),
    maxBytes: Number(process.env.MAX_RESPONSE_BYTES ?? 65536),
  };
}

/** Exact-origin match. Internal hosts are unreachable unless someone deliberately lists them. */
export function checkAllowed(rawUrl: string, allowedOrigins: string[]): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: `Protocol ${url.protocol} is not allowed.` };
  if (url.username || url.password) return { ok: false, reason: "Credentials in URLs are not allowed." };
  if (!allowedOrigins.includes(url.origin)) {
    return { ok: false, reason: `Origin ${url.origin} is not in ALLOWED_API_ORIGINS (${allowedOrigins.join(", ") || "empty"}).` };
  }
  return { ok: true, url };
}

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      chunks.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder().decode(buf), truncated };
}

export async function safeGet(rawUrl: string, opts: SafeFetchOptions = defaultOptions()): Promise<SafeFetchResult> {
  const started = Date.now();
  const allowed = checkAllowed(rawUrl, opts.allowedOrigins);
  if (!allowed.ok) return { kind: "blocked", message: allowed.reason, durationMs: 0 };

  try {
    const res = await fetch(allowed.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual", // never follow redirects to other targets
      signal: AbortSignal.timeout(opts.timeoutMs),
      cache: "no-store",
    });
    const { text, truncated } = await readCapped(res, opts.maxBytes);
    const contentType = res.headers.get("content-type") ?? "";
    let json: unknown;
    if (!truncated && contentType.includes("json")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    const isRedirect = res.status >= 300 && res.status < 400;
    return {
      kind: "response",
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      contentType,
      body: text,
      json,
      truncated,
      durationMs: Date.now() - started,
      ...(isRedirect ? { redirectLocation: res.headers.get("location") ?? "(none)" } : {}),
    };
  } catch (e) {
    const err = e as Error;
    const durationMs = Date.now() - started;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { kind: "timeout", message: `No response within ${opts.timeoutMs} ms.`, durationMs };
    }
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return { kind: "network_error", message: `${err.message}${cause ? ` (${cause})` : ""}`, durationMs };
  }
}
