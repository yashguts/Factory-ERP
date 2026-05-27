export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-32 bg-[var(--muted)] rounded" />
          <div className="h-4 w-20 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 bg-[var(--muted)] rounded" />
          <div className="h-9 w-32 bg-[var(--muted)] rounded" />
        </div>
      </div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="h-9 flex-1 max-w-sm bg-[var(--muted)] rounded" />
        <div className="h-9 w-[140px] bg-[var(--muted)] rounded" />
        <div className="h-9 w-[140px] bg-[var(--muted)] rounded" />
      </div>
      {/* Table */}
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 15 }, (_, i) => (
          <div
            key={i}
            className="h-12 border-t border-[var(--border)] flex items-center gap-4 px-4"
          >
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
            <div className="h-4 w-40 bg-[var(--muted)] rounded" />
            <div className="h-5 w-20 bg-[var(--muted)] rounded-full" />
            <div className="h-4 w-12 bg-[var(--muted)] rounded" />
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
