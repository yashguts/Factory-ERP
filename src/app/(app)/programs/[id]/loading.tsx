export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Title row + action buttons */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-80 max-w-full bg-[var(--muted)] rounded" />
          <div className="h-4 w-48 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-[var(--muted)] rounded" />
          <div className="h-9 w-24 bg-[var(--muted)] rounded" />
          <div className="h-9 w-24 bg-[var(--muted)] rounded" />
        </div>
      </div>
      {/* Inputs / outputs tables + sketch panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="border border-[var(--border)] rounded-lg">
              <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
              {Array.from({ length: 4 }, (_, j) => (
                <div
                  key={j}
                  className="h-11 border-t border-[var(--border)] flex items-center gap-4 px-4"
                >
                  <div className="h-4 w-48 bg-[var(--muted)] rounded" />
                  <div className="h-4 w-16 bg-[var(--muted)] rounded" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="border border-[var(--border)] rounded-lg h-72 bg-[var(--muted)]/40" />
      </div>
    </div>
  );
}
