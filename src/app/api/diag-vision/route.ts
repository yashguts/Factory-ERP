import { NextRequest, NextResponse } from "next/server";
import { createCacheClient } from "@/lib/supabase/cache-client";

/**
 * TEMPORARY diagnostic for the Claude vision wiring — shows the RAW upstream
 * status + body so the request shape can be validated/fixed on the first keyed
 * run. Returns no secrets (key presence + length only). Remove after verifying.
 *   /api/diag-vision?job=<jobId>
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("job");
  const key = process.env.ANTHROPIC_API_KEY;
  const out: Record<string, unknown> = {
    keyPresent: !!key,
    keyLen: key ? key.length : 0,
  };
  if (!key) return NextResponse.json({ ...out, note: "ANTHROPIC_API_KEY not in this deploy's env" });
  if (!jobId) return NextResponse.json({ ...out, note: "add ?job=<jobId>" });

  const supabase = createCacheClient();
  const { data: job } = await supabase.from("jobs").select("gad_drawing_url").eq("id", jobId).single();
  const url = (job?.gad_drawing_url as string | null) ?? null;
  out.drawingUrl = url ? url.slice(0, 80) + "..." : null;
  if (!url) return NextResponse.json({ ...out, note: "job has no drawing" });

  try {
    const pdfRes = await fetch(url);
    if (!pdfRes.ok) return NextResponse.json({ ...out, step: "download", pdfStatus: pdfRes.status });
    const b64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");
    out.pdfKB = Math.round(b64.length / 1365);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        tool_choice: { type: "tool", name: "report_elevator_spec" },
        tools: [
          {
            name: "report_elevator_spec",
            description: "Report the elevator spec from the drawing.",
            input_schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                drive_type: { type: ["string", "null"] },
                floors: { type: ["integer", "null"] },
                capacity: { type: ["string", "null"] },
              },
              required: ["drive_type", "floors", "capacity"],
            },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
              { type: "text", text: "Read this elevator GA drawing and call report_elevator_spec with drive_type, floors, capacity." },
            ],
          },
        ],
      }),
    });
    out.upstreamStatus = resp.status;
    const text = await resp.text();
    if (!resp.ok) {
      out.errorBody = text.slice(0, 900);
      return NextResponse.json(out);
    }
    const data = JSON.parse(text);
    const tool = data.content?.find((b: { type: string }) => b.type === "tool_use");
    out.stopReason = data.stop_reason;
    out.toolInput = tool?.input ?? null;
    out.usage = data.usage ?? null;
    return NextResponse.json(out);
  } catch (e) {
    out.threw = e instanceof Error ? e.message : String(e);
    return NextResponse.json(out);
  }
}
