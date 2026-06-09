import type { Metadata } from "next";
import "./globals.css";
import { StaleDeployGuard } from "@/components/layout/stale-deploy-guard";

export const metadata: Metadata = {
  title: "Factory ERP - Elevator Manufacturing",
  description: "ERP system for elevator manufacturing - Inventory, BOM, and MRP",
};

// Run the app's server functions in Mumbai (ap-south-1), co-located with the
// Supabase database, so every DB round-trip is intra-region (~single-digit ms)
// instead of crossing the US. Consumed by Vercel; a harmless no-op elsewhere.
// Cascades to all routes under this root layout.
export const preferredRegion = "bom1";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <StaleDeployGuard />
      </body>
    </html>
  );
}
