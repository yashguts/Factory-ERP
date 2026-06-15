export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4">
        <div className="h-7 w-64 bg-[var(--muted)] rounded mb-2" />
        <div className="h-4 w-96 bg-[var(--muted)] rounded" />
      </div>
      <div className="h-10 w-[280px] max-w-full bg-[var(--muted)] rounded-lg mb-3" />
      <div className="flex gap-3 mb-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="h-16 w-40 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
      <div className="card-surface p-5 mb-5">
        <div className="flex items-end gap-2 h-[150px]">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="w-[72px] bg-[var(--muted)] rounded-t" style={{ height: `${25 + ((i * 17) % 70)}%` }} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-9 bg-[var(--muted)] rounded" />
        ))}
      </div>
    </div>
  );
}
