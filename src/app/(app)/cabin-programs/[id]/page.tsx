import { redirect } from "next/navigation";

// Retired: cabin programs now live in the main Programs catalogue.
export default function CabinProgramDetailRetired() {
  redirect("/programs");
}
