// In-memory data for the demo store API. Deterministic so demos are repeatable.
export type ProductStatus = "on_sale" | "in_stock" | "out_of_stock";

export interface Product {
  id: number;
  name: string;
  categoryId: number;
  price: number;
  status: ProductStatus;
}

export const CATEGORIES = [
  { id: 1, name: "Kitchen", slug: "kitchen" },
  { id: 2, name: "Books", slug: "books" },
  { id: 3, name: "Outdoor", slug: "outdoor" },
  { id: 4, name: "Electronics", slug: "electronics" },
];

const NAMES = [
  "Cast Iron Pan", "Chef Knife", "French Press", "Mixing Bowl Set", "Tea Kettle",
  "Sci-Fi Novel", "Cookbook", "Travel Guide", "Poetry Collection", "History Atlas",
  "Camping Tent", "Hiking Backpack", "Water Bottle", "Headlamp", "Folding Chair",
  "USB-C Charger", "Wireless Mouse", "Mechanical Keyboard", "Noise-Cancelling Headphones", "E-Reader",
];
const STATUSES: ProductStatus[] = ["in_stock", "on_sale", "in_stock", "out_of_stock", "on_sale"];

export const PRODUCTS: Product[] = NAMES.map((name, i) => ({
  id: i + 1,
  name,
  categoryId: Math.floor(i / 5) + 1,
  price: Math.round((9.9 + i * 7.35) * 100) / 100,
  status: STATUSES[i % STATUSES.length],
}));

export const PRODUCT_STATUSES: ProductStatus[] = ["on_sale", "in_stock", "out_of_stock"];
