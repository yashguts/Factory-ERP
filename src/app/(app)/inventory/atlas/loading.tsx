export default function Loading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="h-7 w-48 skeleton rounded" />
        <div className="flex gap-2">
          <div className="h-8 w-32 skeleton rounded" />
          <div className="h-8 w-24 skeleton rounded" />
        </div>
      </div>
      <div className="h-4 w-80 skeleton rounded mb-3" />
      <div className="flex gap-3" style={{ height: "calc(100vh - 168px)" }}>
        <div className="card-surface w-[340px] shrink-0 p-2 space-y-1.5">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="h-7 skeleton rounded" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
          ))}
        </div>
        <div className="card-surface flex-1 p-3 space-y-2">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="h-6 skeleton rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
