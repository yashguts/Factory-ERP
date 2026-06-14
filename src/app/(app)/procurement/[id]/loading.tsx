export default function Loading() {
  return (
    <div className="space-y-3">
      <div className="h-8 w-64 skeleton rounded-md" />
      <div className="h-24 w-full skeleton rounded-lg" />
      <div className="h-16 w-full skeleton rounded-lg" />
      <div className="h-72 w-full skeleton rounded-lg" />
    </div>
  );
}
