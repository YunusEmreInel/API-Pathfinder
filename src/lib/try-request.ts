// The only code path that sends a request to a target API. Called solely from the
// user-confirmed "Try request" flow (POST /api/try), never from search or the model loop.
import type { ExtractedOperation, OperationParam } from "./openapi";
import { buildRequestUrl, toFetchSnippet } from "./request-builder";
import { safeGet, type SafeFetchResult } from "./safe-fetch";

export type TryOutcome =
  | { state: "not_executable"; operationId: string; reasons: string[] }
  | { state: "needs_input"; operationId: string; missing: OperationParam[]; errors: string[] }
  | {
      state: "sent";
      operationId: string;
      url: string;
      snippet: string;
      result: SafeFetchResult;
      /** Plain statement of what the HTTP layer tells us — deliberately not "goal achieved". */
      verdict: string;
    };

function verdictFor(r: SafeFetchResult): string {
  if (r.kind !== "response") {
    const prefix = { blocked: "Not sent", timeout: "Request timed out", network_error: "Network error" }[r.kind];
    return `${prefix}: ${r.message}`;
  }
  if (r.redirectLocation) return `HTTP ${r.status} redirect to ${r.redirectLocation} — not followed.`;
  if (r.status >= 200 && r.status < 300) {
    return `HTTP ${r.status}: the server accepted the request. This shows the call works, not that the data answers your goal — check the response.`;
  }
  return `HTTP ${r.status}: the API returned an error. This is NOT a successful result.`;
}

export async function tryOperation(
  op: ExtractedOperation,
  serverUrl: string,
  params: Record<string, unknown>,
): Promise<TryOutcome> {
  if (op.blockers.length > 0) return { state: "not_executable", operationId: op.operationId, reasons: op.blockers };
  const built = buildRequestUrl(op, serverUrl, params);
  if (!built.ok) return { state: "needs_input", operationId: op.operationId, missing: built.missing, errors: built.errors };
  const result = await safeGet(built.url);
  return { state: "sent", operationId: op.operationId, url: built.url, snippet: toFetchSnippet(built.url), result, verdict: verdictFor(result) };
}
