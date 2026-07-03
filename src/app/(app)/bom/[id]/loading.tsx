export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-40 bg-[var(--muted)] rounded mb-3" />
      <div className="h-8 w-64 bg-[var(--muted)] rounded mb-2" />
      <div className="h-4 w-52 bg-[var(--muted)] rounded mb-5" />
      {Array.from({ length: 4 }).map((_, s) => (
        <div key={s} className="mb-4 border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="h-8 bg-[var(--muted)]/50 border-b border-[var(--border)]" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`h-10 flex items-center gap-4 px-4 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
            >
              <div className="h-4 w-24 bg-[var(--muted)] rounded" />
              <div className="h-4 w-64 bg-[var(--muted)] rounded" />
              <div className="h-4 w-12 bg-[var(--muted)] rounded ml-auto" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
