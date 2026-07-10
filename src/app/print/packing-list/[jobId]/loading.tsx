export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="h-8 w-64 animate-pulse rounded bg-[var(--muted)]" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-[var(--muted)]" />
        ))}
      </div>
    </div>
  );
}
