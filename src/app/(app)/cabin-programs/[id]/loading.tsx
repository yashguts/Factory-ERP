export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-32 bg-[var(--muted)] rounded mb-4" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-64 bg-[var(--muted)] rounded" />
          <div className="h-4 w-48 bg-[var(--muted)] rounded mt-2" />
        </div>
        <div className="h-9 w-48 bg-[var(--muted)] rounded" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <div className="h-24 bg-[var(--muted)] rounded-lg" />
          <div className="h-48 bg-[var(--muted)] rounded-lg" />
        </div>
        <div className="h-40 bg-[var(--muted)] rounded-lg" />
      </div>
    </div>
  );
}
