import { redirect } from "next/navigation";

/**
 * The owner removed the Dashboard (2026-06-11) — the root path now lands on
 * Job Orders, the operational hub. Change the target here if the team would
 * rather start somewhere else.
 */
export default function Home() {
  redirect("/jobs");
}
