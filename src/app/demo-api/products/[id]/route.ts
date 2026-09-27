import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/demo-store-data";

// GET /demo-api/products/{id}
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "invalid_id", message: "id must be a positive integer" }, { status: 400 });
  }
  const product = PRODUCTS.find((p) => p.id === Number(id));
  if (!product) {
    return NextResponse.json({ error: "not_found", message: `No product with id ${id}` }, { status: 404 });
  }
  return NextResponse.json(product);
}
