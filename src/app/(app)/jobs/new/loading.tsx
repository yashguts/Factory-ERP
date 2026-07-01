export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Compact header with save pill */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-8 w-40 bg-[var(--muted)] rounded" />
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-[var(--muted)] rounded" />
          <div className="h-9 w-36 bg-[var(--muted)] rounded" />
        </div>
      </div>
      {/* Job Details + Elevator Spec panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {Array.from({ length: 2 }).map((_, p) => (
          <div key={p} className="card-surface p-5">
            <div className="h-5 w-32 bg-[var(--muted)] rounded mb-4" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 bg-[var(--muted)] rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* BOM phase cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="card-surface p-5 mb-4">
          <div className="h-5 w-44 bg-[var(--muted)] rounded mb-4" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-10 bg-[var(--muted)] rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
