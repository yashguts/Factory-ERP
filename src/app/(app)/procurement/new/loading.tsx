export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-56 bg-[var(--muted)] rounded" />
        <div className="h-9 w-32 bg-[var(--muted)] rounded" />
      </div>
      {/* PO details panel */}
      <div className="card-surface p-5 mb-4">
        <div className="h-5 w-32 bg-[var(--muted)] rounded mb-4" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 bg-[var(--muted)] rounded" />
          ))}
        </div>
      </div>
      {/* Line items */}
      <div className="card-surface p-5">
        <div className="h-5 w-28 bg-[var(--muted)] rounded mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-[var(--muted)] rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
