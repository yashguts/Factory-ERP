export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="mb-6">
        <div className="h-8 w-52 bg-[var(--muted)] rounded" />
        <div className="h-4 w-72 bg-[var(--muted)] rounded mt-2" />
      </div>
      {/* Search */}
      <div className="h-9 w-full max-w-md bg-[var(--muted)] rounded mb-4" />
      {/* Job rows */}
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-14 bg-[var(--muted)] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
