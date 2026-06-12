import { NextResponse } from "next/server";
import { createCacheClient } from "@/lib/supabase/cache-client";

/**
 * Perf diagnostics: which region this server function runs in, and the real
 * round-trip time to the Supabase DB (ap-south-1 / Mumbai). Two pings — the
 * first pays TLS/connection setup, the second is the steady-state RTT every
 * sequential query on a page render pays. No auth needed: exposes nothing
 * but latency numbers.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const region =
    process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "unknown";
  const supabase = createCacheClient();

  const pings: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await supabase.from("warehouses").select("id").limit(1);
    pings.push(Date.now() - t);
  }

  return NextResponse.json({
    functionRegion: region,
    dbPingMs: pings,
    note: "ping[0] includes TLS setup; later pings = per-query cost of every sequential DB read",
  });
}
