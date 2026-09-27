// Minimal OpenAPI 3.x (JSON) parser: extracts GET operations and resolves local $refs.
// Anything we don't understand is reported explicitly instead of being guessed.

export class OpenApiError extends Error {}

export type ParamType = "string" | "integer" | "number" | "boolean";

export interface OperationParam {
  name: string;
  in: "path" | "query";
  required: boolean;
  type: ParamType;
  enum?: (string | number | boolean)[];
  description?: string;
}

export interface UnsupportedParam {
  name: string;
  in: string;
  required: boolean;
  reason: string;
}

export interface ExtractedOperation {
  operationId: string;
  method: "GET";
  path: string;
  summary: string;
  description: string;
  tags: string[];
  params: OperationParam[];
  unsupportedParams: UnsupportedParam[];
  requiresAuth: boolean;
  /** Human-readable reasons this operation cannot be executed by Pathfinder. Empty = executable. */
  blockers: string[];
  /** Short text description of the 200 response shape, taken from the doc. */
  responseSummary: string;
  /** JSON pointer into the source document, e.g. #/paths/~1products/get */
  sourcePointer: string;
}

export interface ParsedDocument {
  title: string;
  version: string;
  openapiVersion: string;
  serverUrl: string;
  operations: ExtractedOperation[];
  skipped: { method: string; path: string; reason: string }[];
  warnings: string[];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const MAX_REF_DEPTH = 20;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Follows a local JSON pointer like "#/components/schemas/Product". Remote refs are rejected. */
export function resolveRef(doc: Obj, ref: string): Json {
  if (!ref.startsWith("#/")) {
    throw new OpenApiError(`Unsupported $ref "${ref}": only local refs (starting with "#/") are resolved; remote refs are never downloaded.`);
  }
  let node: Json = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(node) || !(key in node)) {
      throw new OpenApiError(`Could not resolve $ref "${ref}" (missing "${key}").`);
    }
    node = node[key];
  }
  return node;
}

/** Replaces a node that is `{ "$ref": ... }` with its target, following chains. Does not recurse into children. */
export function deref(doc: Obj, node: Json, depth = 0): Json {
  if (depth > MAX_REF_DEPTH) throw new OpenApiError("$ref chain too deep (possible cycle).");
  if (isObj(node) && typeof node.$ref === "string") {
    return deref(doc, resolveRef(doc, node.$ref), depth + 1);
  }
  return node;
}

function parseParam(doc: Obj, raw: Json): { ok: OperationParam } | { bad: UnsupportedParam } {
  const p = deref(doc, raw);
  if (!isObj(p) || typeof p.name !== "string" || typeof p.in !== "string") {
    throw new OpenApiError("Parameter object is missing 'name' or 'in'.");
  }
  const required = p.in === "path" ? true : p.required === true;
  const bad = (reason: string) => ({ bad: { name: p.name as string, in: p.in as string, required, reason } });

  if (p.in !== "path" && p.in !== "query") return bad(`'${p.in}' parameters are not supported (only path and query).`);
  if (p.content !== undefined) return bad("Parameters defined with 'content' are not supported.");
  const schema = deref(doc, p.schema ?? null);
  if (!isObj(schema)) return bad("Parameter has no schema.");
  const type = schema.type;
  if (type !== "string" && type !== "integer" && type !== "number" && type !== "boolean") {
    return bad(`Schema type '${String(type)}' is not supported (only string, integer, number, boolean).`);
  }
  if (p.style !== undefined && p.style !== (p.in === "path" ? "simple" : "form")) {
    return bad(`Parameter style '${String(p.style)}' is not supported.`);
  }
  const param: OperationParam = { name: p.name, in: p.in, required, type };
  if (Array.isArray(schema.enum)) {
    param.enum = schema.enum.filter((e): e is string | number | boolean => ["string", "number", "boolean"].includes(typeof e));
  }
  if (typeof p.description === "string") param.description = p.description;
  return { ok: param };
}

function summarizeSchema(doc: Obj, schemaRaw: Json, depth = 0): string {
  if (depth > 3) return "…";
  const schema = deref(doc, schemaRaw);
  if (!isObj(schema)) return "unknown";
  if (schema.type === "array") return `array of ${summarizeSchema(doc, schema.items ?? null, depth + 1)}`;
  if (isObj(schema.properties)) {
    const fields = Object.entries(schema.properties).map(([k, v]) => {
      const inner = deref(doc, v);
      const t = isObj(inner) ? (inner.type === "array" ? summarizeSchema(doc, inner, depth + 1) : String(inner.type ?? "object")) : "?";
      return `${k}: ${t}`;
    });
    return `{ ${fields.join(", ")} }`;
  }
  return String(schema.type ?? "object");
}

function responseSummary(doc: Obj, op: Obj): string {
  const responses = isObj(op.responses) ? op.responses : {};
  const ok = deref(doc, responses["200"] ?? null);
  if (!isObj(ok)) return "No 200 response documented.";
  const desc = typeof ok.description === "string" ? ok.description : "";
  const json = isObj(ok.content) ? ok.content["application/json"] : undefined;
  const shape = isObj(json) && json.schema !== undefined ? summarizeSchema(doc, json.schema) : "no JSON schema";
  return `${desc} Shape: ${shape}`.trim();
}

function hasSecurity(value: Json | undefined): boolean {
  // `security: []` or `[{}]` means "no auth required".
  return Array.isArray(value) && value.some((req) => isObj(req) && Object.keys(req).length > 0);
}

export function parseOpenApi(input: unknown): ParsedDocument {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      throw new OpenApiError(`Input is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (!isObj(doc)) throw new OpenApiError("OpenAPI document must be a JSON object.");
  if (typeof doc.openapi !== "string" || !/^3\.\d+/.test(doc.openapi)) {
    const hint = typeof doc.swagger === "string" ? " (Swagger 2.0 is not supported)" : "";
    throw new OpenApiError(`Only OpenAPI 3.x documents are supported${hint}.`);
  }
  if (!isObj(doc.paths)) throw new OpenApiError("Document has no 'paths' object.");
  const info = isObj(doc.info) ? doc.info : {};

  const warnings: string[] = [];
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const firstServer = servers.find(isObj);
  let serverUrl = firstServer && typeof firstServer.url === "string" ? firstServer.url : "";
  if (!serverUrl) warnings.push("No servers[0].url in document; operations cannot be executed until one is provided.");
  if (serverUrl && !/^https?:\/\//.test(serverUrl)) {
    warnings.push(`servers[0].url "${serverUrl}" is not an absolute http(s) URL; requests cannot be sent.`);
    serverUrl = "";
  }
  if (serverUrl.includes("{")) {
    warnings.push("Server URL variables are not supported; requests cannot be sent.");
    serverUrl = "";
  }
  serverUrl = serverUrl.replace(/\/+$/, "");

  const globalAuth = hasSecurity(doc.security);
  const operations: ExtractedOperation[] = [];
  const skipped: ParsedDocument["skipped"] = [];
  const usedIds = new Set<string>();

  for (const [path, rawItem] of Object.entries(doc.paths)) {
    const item = deref(doc, rawItem);
    if (!isObj(item)) continue;
    for (const m of HTTP_METHODS) {
      if (m !== "get" && item[m] !== undefined) skipped.push({ method: m.toUpperCase(), path, reason: "Only GET operations are supported." });
    }
    const op = item.get;
    if (!isObj(op)) continue;
    const sourcePointer = `#/paths/${escapePointer(path)}/get`;

    // Operation-level parameters override path-level ones with the same name+in.
    const merged = new Map<string, Json>();
    for (const list of [item.parameters, op.parameters]) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const p = deref(doc, raw);
        if (isObj(p)) merged.set(`${String(p.in)}:${String(p.name)}`, raw);
      }
    }
    const params: OperationParam[] = [];
    const unsupportedParams: UnsupportedParam[] = [];
    for (const raw of merged.values()) {
      const r = parseParam(doc, raw);
      if ("ok" in r) params.push(r.ok);
      else unsupportedParams.push(r.bad);
    }

    // Every {placeholder} in the path must be backed by a declared path parameter.
    for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
      if (!params.some((p) => p.in === "path" && p.name === name) && !unsupportedParams.some((p) => p.name === name)) {
        unsupportedParams.push({ name, in: "path", required: true, reason: "Path placeholder has no parameter definition." });
      }
    }

    let operationId = typeof op.operationId === "string" && op.operationId.trim() ? op.operationId.trim() : "";
    if (!operationId) {
      operationId = `get_${path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}` || "get_root";
      warnings.push(`GET ${path} has no operationId; using generated id "${operationId}".`);
    }
    if (usedIds.has(operationId)) throw new OpenApiError(`Duplicate operationId "${operationId}".`);
    usedIds.add(operationId);

    const requiresAuth = op.security !== undefined ? hasSecurity(op.security) : globalAuth;
    const blockers: string[] = [];
    if (requiresAuth) blockers.push("Requires authentication (not supported in v1).");
    for (const u of unsupportedParams) if (u.required) blockers.push(`Required parameter '${u.name}': ${u.reason}`);
    if (!serverUrl) blockers.push("Document has no usable server URL.");

    operations.push({
      operationId,
      method: "GET",
      path,
      summary: typeof op.summary === "string" ? op.summary : "",
      description: typeof op.description === "string" ? op.description : "",
      tags: Array.isArray(op.tags) ? op.tags.filter((t): t is string => typeof t === "string") : [],
      params,
      unsupportedParams,
      requiresAuth,
      blockers,
      responseSummary: responseSummary(doc, op),
      sourcePointer,
    });
  }

  if (operations.length === 0) warnings.push("No GET operations found.");

  return {
    title: typeof info.title === "string" ? info.title : "Untitled API",
    version: typeof info.version === "string" ? info.version : "",
    openapiVersion: doc.openapi,
    serverUrl,
    operations,
    skipped,
    warnings,
  };
}
