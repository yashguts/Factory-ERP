import { redirect } from "next/navigation";

// Cabin MRP retired alongside folding cabin programs into the main Programs
// catalogue. Cabin demand continues to flow through Cabin Jobs.
export default function CabinMrpRetired() {
  redirect("/mrp");
}
