import { NextResponse } from "next/server";
import { createCacheClient } from "@/lib/supabase/cache-client";

// Diagnostic endpoint: which AWS region does the Netlify function run in,
// and what does one Supabase round-trip cost from there? Safe to leave in —
// it reads a single row and exposes no data.
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createCacheClient();
  const pings: number[] = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    await supabase.from("warehouses").select("id").limit(1);
    pings.push(Date.now() - t0);
  }
  return NextResponse.json({
    functionRegion:
      process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "unknown",
    supabaseRegion: "ap-south-1 (Mumbai)",
    supabasePingMs: pings,
    note: "ping[0] includes TLS/connection setup; ping[1..3] ≈ pure per-query round-trip",
  });
}
