export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="h-7 w-64 bg-[var(--muted)] rounded" />
          <div className="h-4 w-32 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-[var(--muted)] rounded" />
          <div className="h-8 w-24 bg-[var(--muted)] rounded" />
        </div>
      </div>
      {/* Toolbar */}
      <div className="flex gap-2 mb-3">
        <div className="h-8 flex-1 max-w-sm bg-[var(--muted)] rounded" />
        <div className="h-8 w-24 bg-[var(--muted)] rounded ml-auto" />
      </div>
      {/* Section rows */}
      <div className="space-y-1">
        {Array.from({ length: 16 }, (_, i) => (
          <div key={i} className="h-9 border border-[var(--border)] rounded-md bg-[var(--card)] flex items-center gap-2 px-3">
            <div className="h-4 w-4 bg-[var(--muted)] rounded" />
            <div className="h-4 w-48 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
