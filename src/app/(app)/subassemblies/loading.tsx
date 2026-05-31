export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-48 bg-[var(--muted)] rounded mb-2" />
      <div className="h-4 w-96 max-w-full bg-[var(--muted)] rounded mb-6" />
      <div className="h-24 bg-[var(--muted)] rounded-lg mb-6" />
      <div className="h-5 w-40 bg-[var(--muted)] rounded mb-3" />
      <div className="space-y-px">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 bg-[var(--muted)]/60 rounded" />
        ))}
      </div>
    </div>
  );
}
