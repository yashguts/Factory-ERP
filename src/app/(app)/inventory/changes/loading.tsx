export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-52 bg-[var(--muted)] rounded" />
          <div className="h-4 w-36 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="h-9 w-40 bg-[var(--muted)] rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-20 border border-[var(--border)] rounded-lg bg-[var(--muted)]/40"
          />
        ))}
      </div>
    </div>
  );
}
