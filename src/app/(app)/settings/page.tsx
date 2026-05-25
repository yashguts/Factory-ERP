export default function SettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Configure categories, units, warehouses, and system preferences
        </p>
      </div>
      <div className="border border-[var(--border)] rounded-lg p-12 text-center">
        <p className="text-[var(--muted-foreground)]">
          Settings module will be built alongside Supabase integration.
        </p>
      </div>
    </div>
  );
}
