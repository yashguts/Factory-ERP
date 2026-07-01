export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-8 w-44 bg-[var(--muted)] rounded" />
        <div className="h-4 w-72 bg-[var(--muted)] rounded mt-2" />
      </div>
      {/* Wizard card */}
      <div className="card-surface p-8">
        <div className="h-5 w-52 bg-[var(--muted)] rounded mb-4" />
        <div className="h-40 w-full bg-[var(--muted)] rounded-lg mb-4" />
        <div className="h-9 w-36 bg-[var(--muted)] rounded" />
      </div>
    </div>
  );
}
