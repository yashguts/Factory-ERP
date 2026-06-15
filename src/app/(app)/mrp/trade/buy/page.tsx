import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ date?: string }>;
}

// The Buy list is now folded into the Trade "what to buy" page (steel sheets show
// as their own category group there). Keep this route as a redirect so old links /
// bookmarks land on the merged view.
export default async function TradeBuyPage({ searchParams }: Props) {
  const { date } = await searchParams;
  redirect(`/mrp/trade${date ? `?date=${date}` : ""}`);
}
