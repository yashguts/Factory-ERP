export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4">
        <div className="h-6 w-48 bg-[var(--muted)] rounded" />
        <div className="h-4 w-96 bg-[var(--muted)] rounded mt-2" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] items-start">
        <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="h-8 w-full bg-[var(--muted)] rounded" />
          ))}
        </div>
        <div className="space-y-3">
          <div className="h-14 w-full bg-[var(--muted)] rounded-lg" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="border border-[var(--border)] rounded-lg p-3">
              <div className="h-5 w-64 bg-[var(--muted)] rounded" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 4 }, (_, j) => (
                  <div key={j} className="h-4 w-full bg-[var(--muted)] rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
