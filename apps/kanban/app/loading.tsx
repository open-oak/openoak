export default function Loading() {
  return (
    <main className="kanban-shell flex min-h-dvh items-center justify-center px-6">
      <div className="persistent-background" aria-hidden />
      <div className="rounded-[var(--radius)] border border-border bg-card px-8 py-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
        <div className="mx-auto mb-5 size-9 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden />
        <p className="text-base font-bold text-foreground" role="status">
          Opening OpenKanban
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Checking your session.</p>
      </div>
    </main>
  );
}
