export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="h-5 w-5 bg-[var(--muted)] rounded" />
        <div>
          <div className="h-6 w-56 bg-[var(--muted)] rounded" />
          <div className="h-4 w-72 bg-[var(--muted)] rounded mt-2" />
        </div>
      </div>
      <div className="h-32 w-full bg-[var(--muted)] rounded-lg" />
    </div>
  );
}
