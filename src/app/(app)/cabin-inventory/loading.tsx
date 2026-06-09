export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-56 bg-[var(--muted)] rounded" />
      <div className="h-4 w-32 bg-[var(--muted)] rounded mt-2 mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="h-28 border border-[var(--border)] rounded-lg bg-[var(--muted)]/40"
          />
        ))}
      </div>
    </div>
  );
}
