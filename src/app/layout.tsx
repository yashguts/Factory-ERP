import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StaleDeployGuard } from "@/components/layout/stale-deploy-guard";

// Wire a real typeface to --font-sans. globals.css references var(--font-sans)
// in `body`, but the variable was never defined, so the app silently rendered
// system-ui. Inter (with the cv* features already requested in globals) is the
// single biggest lift to perceived polish.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

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
    <html lang="en" className={inter.variable}>
      <body className="antialiased">
        {children}
        <StaleDeployGuard />
      </body>
    </html>
  );
}
