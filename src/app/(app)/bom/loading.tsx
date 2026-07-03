export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-72 bg-[var(--muted)] rounded mb-2" />
      <div className="h-4 w-96 bg-[var(--muted)] rounded mb-5" />
      <div className="border border-[var(--border)] rounded-lg">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className={`h-10 flex items-center gap-4 px-4 ${i > 0 ? "border-t border-[var(--border)]" : ""}`}
          >
            <div className="h-4 w-28 bg-[var(--muted)] rounded" />
            <div className="h-4 w-56 bg-[var(--muted)] rounded" />
            <div className="h-4 w-12 bg-[var(--muted)] rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
