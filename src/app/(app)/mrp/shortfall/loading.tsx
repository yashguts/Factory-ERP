export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-8 w-56 bg-[var(--muted)] rounded" />
        <div className="h-4 w-80 bg-[var(--muted)] rounded mt-2" />
      </div>
      <div className="h-40 bg-[var(--muted)] rounded-lg mb-6" />
      <div className="border border-[var(--border)] rounded-lg">
        <div className="h-10 bg-[var(--muted)] rounded-t-lg" />
        {Array.from({ length: 6 }, (_, i) => (
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
