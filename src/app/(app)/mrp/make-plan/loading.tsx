export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-56 bg-[var(--muted)] rounded" />
          <div className="h-4 w-80 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="h-9 w-40 bg-[var(--muted)] rounded" />
      </div>
      {/* Summary strip */}
      <div className="flex gap-3 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 w-36 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
      {/* Sheets-to-cut summary */}
      <div className="h-24 w-full bg-[var(--muted)] rounded-lg mb-6" />
      {/* Program cards grouped by category */}
      {Array.from({ length: 3 }).map((_, g) => (
        <div key={g} className="mb-6">
          <div className="h-5 w-48 bg-[var(--muted)] rounded mb-3" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 bg-[var(--muted)] rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
