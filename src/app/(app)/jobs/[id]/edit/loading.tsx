export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-5 w-5 bg-[var(--muted)] rounded" />
        <div className="h-8 w-40 bg-[var(--muted)] rounded" />
      </div>
      <div className="rounded-lg border border-[var(--border)] p-6 space-y-4">
        <div className="h-6 w-32 bg-[var(--muted)] rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-16 bg-[var(--muted)] rounded" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-[var(--border)] p-6 space-y-4">
        <div className="h-6 w-48 bg-[var(--muted)] rounded" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-16 bg-[var(--muted)] rounded" />
          ))}
        </div>
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-40 bg-[var(--muted)] rounded-lg" />
      ))}
    </div>
  );
}
