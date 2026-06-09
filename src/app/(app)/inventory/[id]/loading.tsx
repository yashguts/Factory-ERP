export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Back link + title */}
      <div className="h-4 w-16 bg-[var(--muted)] rounded mb-3" />
      <div className="h-8 w-96 max-w-full bg-[var(--muted)] rounded" />
      <div className="h-4 w-40 bg-[var(--muted)] rounded mt-2 mb-6" />
      {/* Two parts-list cards */}
      {Array.from({ length: 2 }, (_, i) => (
        <div
          key={i}
          className="border border-[var(--border)] rounded-lg mb-6"
        >
          <div className="h-12 bg-[var(--muted)] rounded-t-lg" />
          <div className="p-4 space-y-3">
            <div className="h-9 w-full bg-[var(--muted)] rounded" />
            <div className="h-4 w-28 bg-[var(--muted)] rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
