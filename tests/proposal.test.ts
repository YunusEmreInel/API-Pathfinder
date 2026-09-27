import { describe, expect, it } from "vitest";
import demo from "../demo/store-openapi.json";
import { parseOpenApi } from "@/lib/openapi";
import { embedTextFor, type StoredOperation } from "@/lib/db";
import { paramsFromPairs, validateProposal } from "@/lib/proposal";

const parsed = parseOpenApi(demo);
const ops: StoredOperation[] = parsed.operations.map((op, i) => ({
  pk: i + 1, documentId: 1, serverUrl: parsed.serverUrl, op, embedText: embedTextFor(op), embedded: true,
}));

describe("validateProposal (model proposes, code decides)", () => {
  it("accepts a documented operation and builds the preview URL without sending", () => {
    expect(validateProposal(ops, "listProducts", { status: "on_sale" })).toMatchObject({
      status: "ready", previewUrl: "http://localhost:3000/demo-api/products?status=on_sale",
    });
  });

  it("discards an operation that is not in the document", () => {
    expect(validateProposal(ops, "deleteAllProducts", {}).status).toBe("invalid_suggestion");
    expect(validateProposal(ops, null, {}).status).toBe("no_match");
  });

  it("reports missing required parameters instead of guessing", () => {
    expect(validateProposal(ops, "getProductById", {})).toMatchObject({ status: "needs_input", missing: ["id"] });
  });

  it("drops undeclared parameters the model invented", () => {
    const p = validateProposal(ops, "listCategories", { url: "http://evil.example" });
    expect(p).toMatchObject({ status: "ready", parameters: {}, previewUrl: "http://localhost:3000/demo-api/categories" });
    expect(p.status === "ready" && p.errors[0]).toMatch(/undeclared parameter 'url'/);
  });

  it("refuses operations that need auth", () => {
    expect(validateProposal(ops, "listOrders", {}).status).toBe("not_executable");
  });

  it("parses [{name,value}] pairs defensively", () => {
    expect(paramsFromPairs([{ name: "id", value: 17 }, { name: 1 }, "x"])).toEqual({ id: "17" });
  });
});
