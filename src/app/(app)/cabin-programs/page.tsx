import { redirect } from "next/navigation";

// Cabin Programs were folded into the main Programs catalogue (program_label
// "Cabin Items") so they can be logged in Program Runs. This page is retired —
// send anyone landing here to Programs.
export default function CabinProgramsRetired() {
  redirect("/programs");
}
