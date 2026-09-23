import { Ralph400Client } from "@/components/ralph400/ralph400-client";

export const metadata = { title: "RALPH 400 BOM" };

/**
 * RALPH 400 shaft BOM calculator — the RALPH400_BOM sub-program, ported in
 * from its standalone repo. Pure client-side arithmetic over Sheet2 of
 * "RALPH 400 BOM.xlsx": no Supabase read, no write, nothing to await here.
 */
export default function Ralph400Page() {
  return <Ralph400Client />;
}
