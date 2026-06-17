export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-9 w-72 bg-[var(--muted)] rounded mb-4" />
      <div className="mb-6">
        <div className="h-8 w-64 bg-[var(--muted)] rounded" />
        <div className="h-4 w-80 bg-[var(--muted)] rounded mt-2" />
      </div>
      <div className="grid grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="h-40 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
