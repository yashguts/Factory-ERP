export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-36 bg-[var(--muted)] rounded" />
          <div className="h-4 w-24 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-[var(--muted)] rounded" />
          <div className="h-9 w-32 bg-[var(--muted)] rounded" />
        </div>
      </div>
      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="h-9 flex-1 max-w-sm bg-[var(--muted)] rounded" />
        <div className="h-9 w-[150px] bg-[var(--muted)] rounded" />
        <div className="h-9 w-[150px] bg-[var(--muted)] rounded" />
      </div>
      {/* Table */}
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="h-14 border-t border-[var(--border)] flex items-center gap-4 px-4"
          >
            <div className="h-4 w-20 bg-[var(--muted)] rounded" />
            <div className="h-4 w-32 bg-[var(--muted)] rounded" />
            <div className="h-4 w-40 bg-[var(--muted)] rounded" />
            <div className="h-5 w-16 bg-[var(--muted)] rounded-full" />
            <div className="h-5 w-16 bg-[var(--muted)] rounded-full" />
            <div className="h-4 w-24 bg-[var(--muted)] rounded" />
            <div className="h-5 w-20 bg-[var(--muted)] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
