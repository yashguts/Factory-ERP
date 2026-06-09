export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-16 bg-[var(--muted)] rounded mb-3" />
      <div className="h-8 w-72 bg-[var(--muted)] rounded mb-6" />
      <div className="space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="h-24 border border-[var(--border)] rounded-lg bg-[var(--muted)]/40"
          />
        ))}
      </div>
    </div>
  );
}
