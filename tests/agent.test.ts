// Loop mechanics with a scripted fake model (no network, no database).
// The live Gemini behaviour is verified separately through /api/investigate; this pins the safety rules.
import { beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../demo/store-openapi.json";
import { parseOpenApi } from "@/lib/openapi";
import type { StoredOperation } from "@/lib/db";

const parsed = parseOpenApi(demo);
const ops: StoredOperation[] = parsed.operations.map((op, i) => ({ pk: i + 1, documentId: 1, serverUrl: parsed.serverUrl, op, embedText: "", embedded: true }));

const create = vi.fn();
const outbound = vi.fn();
vi.mock("@/lib/gemini", () => ({ config: { model: () => "fake-model" }, gemini: () => ({ interactions: { create } }) }));
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  getOperations: async () => ops,
  getOperation: async (_d: number, id: string) => ops.find((o) => o.op.operationId === id) ?? null,
  saveTryRun: async () => 1,
}));
vi.mock("@/lib/search", () => ({
  searchOperations: async () => ops.slice(0, 2).map((o) => ({ ...o, distance: 0.3, similarity: 0.7 })),
  hitSummary: (h: StoredOperation & { similarity: number }) => ({ operation_id: h.op.operationId, similarity: h.similarity }),
}));
vi.mock("@/lib/safe-fetch", () => ({ safeGet: outbound }));

const { runAgent, MAX_TOOL_STEPS } = await import("@/lib/agent");
const { modelToolDeclarations } = await import("@/lib/tools");

const call = (name: string, args: object, id = Math.random().toString(36)) => ({ steps: [{ type: "function_call", id, name, arguments: args }] });
const final = (json: object) => ({ steps: [{ type: "model_output" }], output_text: JSON.stringify(json) });

beforeEach(() => { create.mockReset(); outbound.mockReset(); });

describe("agent loop", () => {
  it("never declares try_get_request to the model", () => {
    expect(modelToolDeclarations().map((t) => t.name)).toEqual(["search_endpoints", "inspect_endpoint"]);
  });

  it("runs requested tools on the server and sends results back with the matching call_id", async () => {
    create
      .mockResolvedValueOnce(call("search_endpoints", { query: "products on sale" }, "c1"))
      .mockResolvedValueOnce(call("inspect_endpoint", { operation_id: "listProducts" }, "c2"))
      .mockResolvedValueOnce(final({ operation_id: "listProducts", parameters: [{ name: "status", value: "on_sale" }], reasoning: "", confidence: "high", missing_information: [] }));
    const r = await runAgent(1, "on sale");
    expect(r.trace.map((t) => [t.tool, t.executedBy])).toEqual([["search_endpoints", "server"], ["inspect_endpoint", "server"]]);
    const lastInput = create.mock.calls[2][0].input as { type: string; call_id?: string }[];
    expect(lastInput.filter((s) => s.type === "function_result").map((s) => s.call_id)).toEqual(["c1", "c2"]);
    expect(r.proposal).toMatchObject({ status: "ready", previewUrl: "http://localhost:3000/demo-api/products?status=on_sale" });
  });

  it("refuses a tool the model was not given, and sends no HTTP request", async () => {
    create
      .mockResolvedValueOnce(call("try_get_request", { operation_id: "listProducts", parameters: {} }))
      .mockResolvedValueOnce(final({ operation_id: null, parameters: [], reasoning: "", confidence: "low", missing_information: [] }));
    const r = await runAgent(1, "x");
    expect(r.trace[0]).toMatchObject({ tool: "try_get_request", executedBy: "refused" });
    expect(outbound).not.toHaveBeenCalled();
  });

  it(`stops after ${MAX_TOOL_STEPS} executed tool steps`, async () => {
    create.mockResolvedValue(call("search_endpoints", { query: "again" }));
    const r = await runAgent(1, "loop forever");
    expect(r.trace.filter((t) => t.executedBy === "server")).toHaveLength(MAX_TOOL_STEPS);
    expect(r.stoppedBecause).toBe("step_limit");
    expect(r.proposal.status).toBe("no_match");
  });

  it("discards an operation the model never retrieved through a tool", async () => {
    create.mockResolvedValueOnce(final({ operation_id: "listOrders", parameters: [], reasoning: "", confidence: "high", missing_information: [] }));
    const r = await runAgent(1, "orders");
    expect(r.trace).toHaveLength(0);
    expect(r.proposal.status).toBe("invalid_suggestion");
  });
});
