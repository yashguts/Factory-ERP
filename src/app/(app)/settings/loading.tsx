export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-8 w-48 bg-[var(--muted)] rounded" />
        <div className="h-4 w-72 bg-[var(--muted)] rounded mt-2" />
      </div>
      <div className="h-9 w-72 bg-[var(--muted)] rounded mb-4" />
      <div className="grid grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-12 border-t border-[var(--border)] flex items-center gap-4 px-4">
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
            <div className="h-4 w-48 bg-[var(--muted)] rounded" />
            <div className="h-4 w-16 bg-[var(--muted)] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
