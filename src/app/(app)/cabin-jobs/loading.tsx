export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-44 bg-[var(--muted)] rounded" />
          <div className="h-4 w-24 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="h-9 w-32 bg-[var(--muted)] rounded" />
      </div>
      <div className="h-9 max-w-sm bg-[var(--muted)] rounded mb-4" />
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-12 border-t border-[var(--border)] flex items-center gap-4 px-4"
          >
            <div className="h-4 w-28 bg-[var(--muted)] rounded" />
            <div className="h-4 w-48 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
