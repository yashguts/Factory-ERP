export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-44 bg-[var(--muted)] rounded mb-4" />
      <div className="h-14 bg-[var(--muted)] rounded-lg mb-3" />
      <div className="h-10 bg-[var(--muted)] rounded-lg mb-3" />
      <div className="h-72 bg-[var(--muted)] rounded-lg" />
    </div>
  );
}
