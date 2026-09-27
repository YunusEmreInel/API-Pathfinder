import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Pathfinder",
  description: "Find the right GET endpoint in an OpenAPI document and try it safely.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
