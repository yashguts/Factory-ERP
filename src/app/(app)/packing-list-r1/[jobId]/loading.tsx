export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="h-8 w-64 bg-[var(--muted)] rounded" />
          <div className="h-4 w-44 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 bg-[var(--muted)] rounded" />
          <div className="h-9 w-28 bg-[var(--muted)] rounded" />
        </div>
      </div>
      {/* Builder sections */}
      {Array.from({ length: 5 }).map((_, s) => (
        <div key={s} className="mb-4">
          <div className="h-5 w-40 bg-[var(--muted)] rounded mb-2" />
          <div className="border border-[var(--border)] rounded-lg">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`h-11 flex items-center gap-4 px-4 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
              >
                <div className="h-4 w-48 bg-[var(--muted)] rounded" />
                <div className="h-4 w-16 bg-[var(--muted)] rounded" />
                <div className="h-4 w-24 bg-[var(--muted)] rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
