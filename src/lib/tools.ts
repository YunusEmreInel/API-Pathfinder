// Tool registry. A tool = a JSON-schema declaration the model can see + server code that actually runs it.
// The model can only *request* a call; this file decides whether and how it executes.
import type { StoredOperation } from "./db";
import { getOperation, saveTryRun } from "./db";
import { searchOperations, hitSummary } from "./search";
import { tryOperation, type TryOutcome } from "./try-request";

export interface ToolContext {
  documentId: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** false = never declared to the model; only reachable from the user-confirmed flow. */
  modelCallable: boolean;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

function inspectView(s: StoredOperation) {
  return {
    operation_id: s.op.operationId,
    request: `GET ${s.op.path}`,
    summary: s.op.summary,
    description: s.op.description,
    parameters: s.op.params,
    unsupported_parameters: s.op.unsupportedParams,
    returns: s.op.responseSummary,
    executable: s.op.blockers.length === 0,
    blockers: s.op.blockers,
    source: s.op.sourcePointer,
  };
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const TOOLS: Record<string, ToolDefinition> = {
  search_endpoints: {
    name: "search_endpoints",
    description:
      "Semantic search over the GET operations of the imported OpenAPI document. Returns up to 4 candidates with a similarity score. Similarity is a hint, not proof of relevance.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What the user wants to do, in natural language." } },
      required: ["query"],
    },
    modelCallable: true,
    async run(ctx, args) {
      const query = str(args.query);
      if (!query) return { error: "query is required" };
      const hits = await searchOperations(ctx.documentId, query, 4);
      return { candidates: hits.map(hitSummary) };
    },
  },

  inspect_endpoint: {
    name: "inspect_endpoint",
    description:
      "Returns the documented details of one GET operation: description, parameters (name, location, type, required, enum), response shape and whether Pathfinder can execute it.",
    parameters: {
      type: "object",
      properties: { operation_id: { type: "string", description: "operation_id returned by search_endpoints." } },
      required: ["operation_id"],
    },
    modelCallable: true,
    async run(ctx, args) {
      const id = str(args.operation_id, 128);
      const s = id ? await getOperation(ctx.documentId, id) : null;
      if (!s) return { error: `No operation '${id}' in this document. Do not invent operations.` };
      return inspectView(s);
    },
  },

  try_get_request: {
    name: "try_get_request",
    description: "Sends a real GET request for a documented operation. Requires explicit user confirmation.",
    parameters: {
      type: "object",
      properties: {
        operation_id: { type: "string" },
        parameters: { type: "object", description: "Parameter name -> value" },
      },
      required: ["operation_id", "parameters"],
    },
    // Deliberately NOT given to the model: outbound requests only happen when the user clicks "İsteği dene".
    modelCallable: false,
    async run(ctx, args): Promise<TryOutcome | { error: string }> {
      const id = str(args.operation_id, 128);
      const s = id ? await getOperation(ctx.documentId, id) : null;
      if (!s) return { error: `Operation '${id}' is not in document ${ctx.documentId}.` };
      const params = args.parameters && typeof args.parameters === "object" && !Array.isArray(args.parameters) ? (args.parameters as Record<string, unknown>) : {};
      const outcome = await tryOperation(s.op, s.serverUrl, params);
      await saveTryRun(s.pk, params, outcome);
      return outcome;
    },
  },
};

/** Declarations sent to the model (Interactions API "function" tools). */
export function modelToolDeclarations() {
  return Object.values(TOOLS)
    .filter((t) => t.modelCallable)
    .map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters }));
}
