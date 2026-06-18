export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-56 bg-[var(--muted)] rounded mb-4" />
      <div className="h-16 bg-[var(--muted)] rounded-lg mb-4" />
      <div className="h-40 bg-[var(--muted)] rounded-lg mb-4" />
      <div className="h-64 bg-[var(--muted)] rounded-lg mb-4" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 bg-[var(--muted)] rounded-lg" />
        <div className="h-48 bg-[var(--muted)] rounded-lg" />
      </div>
    </div>
  );
}
