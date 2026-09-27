// Validates a model-suggested request against the stored document. The model proposes; code decides.
import type { StoredOperation } from "./db";
import { buildRequestUrl } from "./request-builder";

export type Proposal =
  | { status: "no_match"; note: string }
  | { status: "invalid_suggestion"; operationId: string; note: string }
  | {
      status: "ready" | "needs_input" | "not_executable";
      operationId: string;
      parameters: Record<string, string>;
      /** URL that WOULD be requested. Nothing has been sent. */
      previewUrl?: string;
      missing: string[];
      errors: string[];
    };

export function validateProposal(
  ops: StoredOperation[],
  operationId: string | null | undefined,
  parameters: Record<string, string>,
): Proposal {
  if (!operationId) return { status: "no_match", note: "The model did not select any operation." };
  const stored = ops.find((o) => o.op.operationId === operationId);
  if (!stored) {
    return { status: "invalid_suggestion", operationId, note: `'${operationId}' does not exist in this document; the suggestion was discarded.` };
  }
  if (stored.op.blockers.length > 0) {
    return { status: "not_executable", operationId, parameters, missing: [], errors: stored.op.blockers };
  }
  // Drop parameters the document does not declare, but report them.
  const known = new Set(stored.op.params.map((p) => p.name));
  const errors = Object.keys(parameters).filter((k) => !known.has(k)).map((k) => `Model suggested undeclared parameter '${k}'; ignored.`);
  const clean = Object.fromEntries(Object.entries(parameters).filter(([k]) => known.has(k)));
  const built = buildRequestUrl(stored.op, stored.serverUrl, clean);
  if (built.ok) return { status: "ready", operationId, parameters: clean, previewUrl: built.url, missing: [], errors };
  return { status: "needs_input", operationId, parameters: clean, missing: built.missing.map((m) => m.name), errors: [...errors, ...built.errors] };
}

/** Gemini schemas can't express free-form maps reliably, so parameters travel as [{name, value}]. */
export function paramsFromPairs(pairs: unknown): Record<string, string> {
  if (!Array.isArray(pairs)) return {};
  const out: Record<string, string> = {};
  for (const p of pairs) {
    if (p && typeof p === "object" && typeof p.name === "string" && (typeof p.value === "string" || typeof p.value === "number")) {
      out[p.name] = String(p.value);
    }
  }
  return out;
}
