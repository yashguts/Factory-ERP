export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-60 bg-[var(--muted)] rounded" />
          <div className="h-4 w-40 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="h-9 w-40 bg-[var(--muted)] rounded" />
      </div>
      <div className="h-24 border border-[var(--border)] rounded-lg bg-[var(--muted)]/40 mb-6" />
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-12 border-t border-[var(--border)] flex items-center gap-4 px-4"
          >
            <div className="h-4 w-40 bg-[var(--muted)] rounded" />
            <div className="h-4 w-64 bg-[var(--muted)] rounded" />
            <div className="h-4 w-12 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
