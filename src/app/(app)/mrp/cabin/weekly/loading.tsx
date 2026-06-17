export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="h-9 w-72 bg-[var(--muted)] rounded mb-4" />
      <div className="mb-6">
        <div className="h-8 w-64 bg-[var(--muted)] rounded" />
        <div className="h-4 w-80 bg-[var(--muted)] rounded mt-2" />
      </div>
      <div className="h-9 w-full max-w-md bg-[var(--muted)] rounded mb-4" />
      <div className="h-64 bg-[var(--muted)] rounded-lg" />
    </div>
  );
}
