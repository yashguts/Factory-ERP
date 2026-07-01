export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-64 bg-[var(--muted)] rounded" />
          <div className="h-4 w-80 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="h-9 w-32 bg-[var(--muted)] rounded" />
      </div>
      {/* Template rows */}
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="h-12 border-t border-[var(--border)] flex items-center gap-4 px-4"
          >
            <div className="h-4 w-8 bg-[var(--muted)] rounded" />
            <div className="h-4 w-56 bg-[var(--muted)] rounded" />
            <div className="h-4 w-32 bg-[var(--muted)] rounded" />
            <div className="h-4 w-20 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
