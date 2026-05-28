import type { Metadata } from "next";
import "./globals.css";
import { StaleDeployGuard } from "@/components/layout/stale-deploy-guard";

export const metadata: Metadata = {
  title: "Factory ERP - Elevator Manufacturing",
  description: "ERP system for elevator manufacturing - Inventory, BOM, and MRP",
};

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
