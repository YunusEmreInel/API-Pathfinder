import { describe, expect, it, vi } from "vitest";
import demo from "../demo/store-openapi.json";
import { parseOpenApi } from "@/lib/openapi";

const outbound = vi.fn();
vi.mock("@/lib/safe-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/safe-fetch")>()), safeGet: outbound }));
const { tryOperation } = await import("@/lib/try-request");

const parsed = parseOpenApi(demo);
const op = (id: string) => parsed.operations.find((o) => o.operationId === id)!;

describe("tryOperation", () => {
  it("does not call out when a required parameter is missing", async () => {
    const r = await tryOperation(op("getProductById"), parsed.serverUrl, {});
    expect(r).toMatchObject({ state: "needs_input", missing: [expect.objectContaining({ name: "id" })] });
    expect(outbound).not.toHaveBeenCalled();
  });

  it("does not call out when the document's server is not allowlisted", async () => {
    const r = await tryOperation(op("listCategories"), "http://169.254.169.254/latest", {});
    expect(r.state).toBe("not_executable");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("does not call out for operations that need auth", async () => {
    expect((await tryOperation(op("listOrders"), parsed.serverUrl, {})).state).toBe("not_executable");
    expect(outbound).not.toHaveBeenCalled();
  });

  it("labels an HTTP error response as an error, not success", async () => {
    outbound.mockResolvedValueOnce({ kind: "response", status: 404, statusText: "Not Found", ok: false, contentType: "application/json", body: "{}", json: {}, truncated: false, durationMs: 1 });
    const r = await tryOperation(op("getProductById"), parsed.serverUrl, { id: "999" });
    expect(r.state === "sent" && r.verdict).toMatch(/NOT a successful result/);
  });
});
