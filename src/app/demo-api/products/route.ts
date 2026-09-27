import { NextRequest, NextResponse } from "next/server";
import { PRODUCTS, PRODUCT_STATUSES, type ProductStatus } from "@/lib/demo-store-data";

// GET /demo-api/products?status=on_sale
export function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status");
  if (status !== null && !PRODUCT_STATUSES.includes(status as ProductStatus)) {
    return NextResponse.json(
      { error: "invalid_status", message: `status must be one of: ${PRODUCT_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }
  const items = status ? PRODUCTS.filter((p) => p.status === status) : PRODUCTS;
  return NextResponse.json({ count: items.length, items });
}
