"use client";

import { useCallback, useEffect, useState } from "react";

export type RecoveryItem = { id: string; title: string; detail?: string; deletedAt: string; canPurge: boolean };
type Page = { items: RecoveryItem[]; nextCursor: string | null };
type Result = { error?: string };

export function RecoveryPanel({ load, restore, purge, onRestore }: {
  load: (cursor?: string) => Promise<Page>;
  restore: (id: string) => Promise<Result>;
  purge: (id: string) => Promise<Result>;
  onRestore?: () => void;
}) {
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = useCallback(async (cursor?: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await load(cursor);
      setPage((current) => ({ ...next, items: cursor ? [...current.items, ...next.items] : next.items }));
    } catch { setError("Could not load deleted items. Check your connection and try again."); }
    finally { setBusy(false); }
  }, [load]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function mutate(id: string, permanent: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await (permanent ? purge(id) : restore(id));
      if (result.error) { setError(result.error); return; }
      setConfirm(null);
      if (!permanent) onRestore?.();
      await refresh();
    } catch { setError("Could not change this item. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  const button = "min-h-10 rounded-lg border px-3 py-2 text-sm disabled:opacity-50 hover:bg-accent/40";
  return <div aria-busy={busy} className="text-foreground">
    <p className="mb-4 text-sm text-muted-foreground">Restore a deleted item, or permanently delete it. Deleting a whole list or folder is not covered by this recovery view.</p>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
    {!page.items.length && !busy && <p className="py-4 text-sm">No deleted items.</p>}
    <ul className="space-y-3">
      {page.items.map((item) => <li key={item.id} className="rounded-xl border p-3">
        <p className="break-words font-medium">{item.title}</p>
        {item.detail && <p className="break-words text-xs text-muted-foreground">{item.detail}</p>}
        <p className="mb-3 text-xs text-muted-foreground">Deleted <time dateTime={item.deletedAt}>{new Date(item.deletedAt).toLocaleString()}</time></p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void mutate(item.id, false)}>Restore</button>
          {item.canPurge && (confirm === item.id ? <>
            <button type="button" className={`${button} text-destructive`} disabled={busy} onClick={() => void mutate(item.id, true)}>Confirm permanent deletion</button>
            <button type="button" className={button} disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
          </> : <button type="button" className={`${button} text-destructive`} disabled={busy} onClick={() => setConfirm(item.id)}>Delete forever</button>)}
        </div>
        {confirm === item.id && <p role="status" className="mt-2 text-sm">This permanently removes the recovery copy. This cannot be undone.</p>}
      </li>)}
    </ul>
    <div className="mt-4 flex gap-2">
      {page.nextCursor && <button type="button" className={button} disabled={busy} onClick={() => void refresh(page.nextCursor!)}>Load more</button>}
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>{busy ? "Loading…" : "Refresh"}</button>
    </div>
  </div>;
}
