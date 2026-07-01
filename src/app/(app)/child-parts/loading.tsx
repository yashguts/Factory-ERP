export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="h-6 w-44 bg-[var(--muted)] rounded" />
          <div className="h-4 w-72 bg-[var(--muted)] rounded mt-2" />
        </div>
      </div>
      <div className="h-9 w-full max-w-sm bg-[var(--muted)] rounded mb-4" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="border border-[var(--border)] rounded-lg p-3">
            <div className="h-5 w-56 bg-[var(--muted)] rounded" />
            <div className="h-4 w-32 bg-[var(--muted)] rounded mt-2" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }, (_, j) => (
                <div key={j} className="h-4 w-full bg-[var(--muted)] rounded" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
