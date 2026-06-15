export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-4">
        <div className="h-7 w-64 bg-[var(--muted)] rounded mb-2" />
        <div className="h-4 w-96 bg-[var(--muted)] rounded" />
      </div>
      <div className="h-10 w-[360px] max-w-full bg-[var(--muted)] rounded-lg mb-3" />
      <div className="flex gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 w-32 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-12 border-t border-[var(--border)] flex items-center gap-4 px-4">
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
            <div className="h-4 w-40 bg-[var(--muted)] rounded" />
            <div className="h-4 w-12 bg-[var(--muted)] rounded" />
            <div className="h-4 w-12 bg-[var(--muted)] rounded" />
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
