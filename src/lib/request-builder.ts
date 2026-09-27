// Builds a GET URL strictly from an OpenAPI operation + validated parameters.
// The caller never supplies a URL; only values for parameters the document declares.
import type { ExtractedOperation, OperationParam } from "./openapi";

export type BuildResult =
  | { ok: true; url: string; used: Record<string, string> }
  | { ok: false; missing: OperationParam[]; errors: string[] };

const MAX_VALUE_LENGTH = 200;

function normalize(param: OperationParam, raw: unknown): { value?: string; error?: string } {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
    return { error: `'${param.name}' must be a single ${param.type} value.` };
  }
  const value = String(raw).trim();
  if (value.length > MAX_VALUE_LENGTH) return { error: `'${param.name}' is too long.` };
  if (param.type === "integer" && !/^-?\d+$/.test(value)) return { error: `'${param.name}' must be an integer.` };
  if (param.type === "number" && !Number.isFinite(Number(value))) return { error: `'${param.name}' must be a number.` };
  if (param.type === "boolean" && value !== "true" && value !== "false") return { error: `'${param.name}' must be true or false.` };
  if (param.enum && param.enum.length > 0 && !param.enum.map(String).includes(value)) {
    return { error: `'${param.name}' must be one of: ${param.enum.join(", ")}.` };
  }
  if (param.in === "path" && (value === "." || value === "..")) return { error: `'${param.name}' is not a valid path segment.` };
  return { value };
}

function isEmpty(v: unknown) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

export function buildRequestUrl(
  op: ExtractedOperation,
  serverUrl: string,
  input: Record<string, unknown>,
): BuildResult {
  const errors: string[] = [];
  const missing: OperationParam[] = [];
  const used: Record<string, string> = {};

  const known = new Set(op.params.map((p) => p.name));
  for (const key of Object.keys(input)) {
    if (!known.has(key) && !isEmpty(input[key])) errors.push(`Unknown parameter '${key}' (not declared in the document for ${op.operationId}).`);
  }
  for (const u of op.unsupportedParams) {
    if (u.required) errors.push(`Required parameter '${u.name}' is unsupported: ${u.reason}`);
  }

  let path = op.path;
  const query = new URLSearchParams();
  for (const param of op.params) {
    const raw = input[param.name];
    if (isEmpty(raw)) {
      if (param.required) missing.push(param);
      continue;
    }
    const { value, error } = normalize(param, raw);
    if (error || value === undefined) {
      errors.push(error ?? `Invalid '${param.name}'.`);
      continue;
    }
    used[param.name] = value;
    if (param.in === "path") path = path.split(`{${param.name}}`).join(encodeURIComponent(value));
    else query.append(param.name, value);
  }

  if (missing.length > 0 || errors.length > 0) return { ok: false, missing, errors };
  if (/\{[^}]*\}/.test(path)) return { ok: false, missing, errors: ["Path still contains unresolved placeholders."] };

  let base: URL;
  try {
    base = new URL(serverUrl);
  } catch {
    return { ok: false, missing, errors: [`Server URL "${serverUrl}" is not a valid URL.`] };
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  const url = new URL(base.origin + basePath + path);
  const qs = query.toString();
  if (qs) url.search = qs;

  // Defence in depth: the final URL must stay on the server origin and under its base path.
  if (url.origin !== base.origin || !url.pathname.startsWith(basePath + "/")) {
    return { ok: false, missing, errors: ["Built URL escapes the document's server base path."] };
  }
  return { ok: true, url: url.toString(), used };
}

/** A runnable TypeScript snippet the user can copy. Values are JSON-escaped, never interpolated raw. */
export function toFetchSnippet(url: string): string {
  return [
    `const res = await fetch(${JSON.stringify(url)}, {`,
    `  method: "GET",`,
    `  headers: { Accept: "application/json" },`,
    `});`,
    `if (!res.ok) throw new Error(\`HTTP \${res.status}\`);`,
    `const data: unknown = await res.json();`,
    `console.log(data);`,
  ].join("\n");
}
