import { describe, expect, it } from "vitest";
import demo from "../demo/store-openapi.json";
import { OpenApiError, parseOpenApi } from "@/lib/openapi";

describe("parseOpenApi", () => {
  const parsed = parseOpenApi(demo);

  it("extracts only GET operations and reports skipped methods", () => {
    expect(parsed.operations.map((o) => o.operationId)).toEqual(["listProducts", "getProductById", "listCategories", "listOrders"]);
    expect(parsed.skipped).toContainEqual({ method: "POST", path: "/products", reason: "Only GET operations are supported." });
  });

  it("resolves local $ref parameters, including path-level ones", () => {
    const list = parsed.operations.find((o) => o.operationId === "listProducts")!;
    expect(list.params).toEqual([
      expect.objectContaining({ name: "status", in: "query", required: false, type: "string", enum: ["on_sale", "in_stock", "out_of_stock"] }),
    ]);
    const byId = parsed.operations.find((o) => o.operationId === "getProductById")!;
    expect(byId.params).toEqual([expect.objectContaining({ name: "id", in: "path", required: true, type: "integer" })]);
    expect(byId.sourcePointer).toBe("#/paths/~1products~1{id}/get");
    expect(byId.responseSummary).toContain("name: string");
  });

  it("marks operations that need auth as not executable", () => {
    const orders = parsed.operations.find((o) => o.operationId === "listOrders")!;
    expect(orders.requiresAuth).toBe(true);
    expect(orders.blockers.length).toBeGreaterThan(0);
  });

  it("rejects remote $refs with a clear error instead of downloading them", () => {
    const doc = {
      openapi: "3.0.0", info: { title: "x", version: "1" }, servers: [{ url: "http://localhost:3000" }],
      paths: { "/a": { get: { parameters: [{ $ref: "https://example.com/params.json#/Foo" }], responses: {} } } },
    };
    expect(() => parseOpenApi(doc)).toThrow(/only local refs/);
  });

  it("rejects unresolved local refs and non-3.x documents", () => {
    const doc = {
      openapi: "3.1.0", info: {}, servers: [{ url: "http://localhost:3000" }],
      paths: { "/a": { get: { parameters: [{ $ref: "#/components/parameters/Nope" }] } } },
    };
    expect(() => parseOpenApi(doc)).toThrow(OpenApiError);
    expect(() => parseOpenApi({ swagger: "2.0", paths: {} })).toThrow(/Swagger 2.0/);
    expect(() => parseOpenApi("{not json")).toThrow(/not valid JSON/);
  });

  it("flags unsupported parameter shapes explicitly", () => {
    const doc = {
      openapi: "3.0.0", info: {}, servers: [{ url: "http://localhost:3000" }],
      paths: {
        "/search": {
          get: {
            operationId: "search",
            parameters: [
              { name: "tags", in: "query", required: true, schema: { type: "array", items: { type: "string" } } },
              { name: "X-Trace", in: "header", schema: { type: "string" } },
            ],
          },
        },
      },
    };
    const op = parseOpenApi(doc).operations[0];
    expect(op.params).toEqual([]);
    expect(op.unsupportedParams.map((u) => u.name)).toEqual(["tags", "X-Trace"]);
    expect(op.blockers.join(" ")).toMatch(/tags/); // required + unsupported => cannot run
  });
});
