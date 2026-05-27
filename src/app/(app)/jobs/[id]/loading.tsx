export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-4 w-24 bg-[var(--muted)] rounded" />
        <div className="h-8 w-48 bg-[var(--muted)] rounded" />
        <div className="h-6 w-16 bg-[var(--muted)] rounded-full" />
      </div>
      <div className="h-12 bg-[var(--muted)] rounded-lg" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="h-14 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-[var(--muted)] rounded-lg" />
    </div>
  );
}
