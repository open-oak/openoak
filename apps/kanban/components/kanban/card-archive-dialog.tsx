"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { KanbanBrowserApi } from "@/lib/kanban-browser-api";
import type { KanbanList, TaskColorId } from "@/lib/kanban-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { TaskDetailDialog } from "./task-detail-dialog";

type Entry = { id: string; title: string; listId: string; deletionId: string; archivedAt: string; color?: TaskColorId | null };
type Detail = Awaited<ReturnType<KanbanBrowserApi["completeCard"]>>;
type Confirmation = { kind: "card"; card: Entry } | { kind: "all"; count: number; revision: number };

function archiveGroup(at: string) {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  if (new Date(at) >= day) return "Today";
  day.setDate(day.getDate() - 6);
  return new Date(at) >= day ? "Past 7 days" : "Older";
}

export function CardArchiveDialog({ accountId, boardKey, boardName, lists, open, canPurge, onOpenChange, onRecover, onPurgeAll, onReturnFocus }: {
  accountId: string; boardKey: string; boardName: string; lists: KanbanList[]; open: boolean; canPurge: boolean;
  onOpenChange: (open: boolean) => void;
  onRecover: (id: string, deletionId: string, permanent: boolean, destinationListId?: string) => Promise<void>;
  onPurgeAll: (revision: number) => Promise<void>;
  onReturnFocus: () => void;
}) {
  const api = useMemo(() => new KanbanBrowserApi(fetch, accountId), [accountId]);
  const [items, setItems] = useState<Entry[]>([]), [cursor, setCursor] = useState<string>();
  const [query, setQuery] = useState(""), [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0), [working, setWorking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null), [destination, setDestination] = useState<Entry | null>(null);
  const [destinationListId, setDestinationListId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null), [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const [announcement, setAnnouncement] = useState(""), [mobile, setMobile] = useState(true);
  const generation = useRef(0), detailGeneration = useRef(0), loadedCount = useRef(50);
  const searchRef = useRef<HTMLInputElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    if (!open) return;
    const timer = window.setTimeout(async () => {
      setBusy(true); setError("");
      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      try {
        const entries: Entry[] = [];
        let next: string | undefined;
        do {
          const page = await api.read("archive", { boardKey, query, limit: 50, ...(next ? { cursor: next } : {}) });
          if (current !== generation.current) return;
          entries.push(...page.items); next = page.nextCursor;
        } while (next && entries.length < loadedCount.current);
        setItems(entries); setCursor(next); setLoadedQuery(query); setBusy(false);
        requestAnimationFrame(() => { if (current === generation.current && scrollRef.current) scrollRef.current.scrollTop = scrollTop; });
      } catch (e) {
        if (current === generation.current) { setError(e instanceof Error ? e.message : "Unable to load the archive."); setBusy(false); setLoadedQuery(query); }
      }
    }, query ? 200 : 0);
    return () => { window.clearTimeout(timer); generation.current = current + 1; };
  }, [api, boardKey, open, query, refresh]);

  function closeDetail() { detailGeneration.current++; setDetail(null); setDetailEntry(null); }
  function focusCard() {
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    searchRef.current?.focus();
  }
  function changeOpen(value: boolean) {
    if (confirm || working) return;
    closeDetail(); setDestination(null); setAnnouncement("");
    onOpenChange(value);
  }
  async function more() {
    if (!cursor) return;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const page = await api.read("archive", { boardKey, query, cursor, limit: 50 });
      if (current === generation.current) { loadedCount.current += page.items.length; setItems((previous) => [...previous, ...page.items]); setCursor(page.nextCursor); }
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Unable to load the archive."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function inspect(card: Entry) {
    const current = ++detailGeneration.current;
    setDetailEntry(card); setDetail(null); setError("");
    try {
      const result = await api.completeCard(boardKey, card.id, true);
      if (current === detailGeneration.current) setDetail(result);
    } catch (e) { if (current === detailGeneration.current) { setError(e instanceof Error ? e.message : "Unable to open this card."); setDetailEntry(null); } }
  }
  function openCard(event: React.MouseEvent<HTMLButtonElement>) {
    const card = items.find((item) => item.deletionId === event.currentTarget.dataset.archiveId);
    if (!card) return;
    returnFocus.current = event.currentTarget;
    void inspect(card);
  }
  async function recover(card: Entry, permanent = false, listId?: string) {
    setWorking(card.id); setError("");
    try {
      await onRecover(card.id, card.deletionId, permanent, listId);
      setItems((previous) => previous.filter((item) => item.deletionId !== card.deletionId));
      setDestination(null); closeDetail();
      setAnnouncement(permanent ? "Card deleted" : `Restored to ${lists.find((list) => list.id === (listId ?? card.listId))?.name ?? "board"}`);
      setRefresh((value) => value + 1);
      searchRef.current?.focus();
    } catch (e) { closeDetail(); setError(e instanceof Error ? e.message : "Unable to save this change."); }
    finally { setWorking(null); }
  }
  function restore(card: Entry) {
    if (lists.some((list) => list.id === card.listId)) void recover(card);
    else { closeDetail(); setDestination(card); setDestinationListId(lists[0]?.id ?? ""); }
  }
  async function prepareDeleteAll() {
    setWorking("all"); setError("");
    try {
      let next: string | undefined, count = 0, revision = 0;
      do {
        const page = await api.read("archive", { boardKey, limit: 50, ...(next ? { cursor: next } : {}) });
        count += page.items.length; revision = page.revision; next = page.nextCursor;
      } while (next);
      if (count) setConfirm({ kind: "all", count, revision });
      else { setItems([]); setCursor(undefined); setAnnouncement("No archived cards to delete"); }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read the archive. Try again."); }
    finally { setWorking(null); }
  }
  async function deleteAll(revision: number) {
    setWorking("all"); setError("");
    try {
      await onPurgeAll(revision);
      setItems([]); setCursor(undefined); closeDetail(); setDestination(null);
      setAnnouncement("All archived cards deleted"); setRefresh((value) => value + 1); searchRef.current?.focus();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete the archive. Try again."); }
    finally { setWorking(null); }
  }
  const searching = busy || loadedQuery !== query;
  return <>
    <Dialog open={open} modal={mobile} onOpenChange={changeOpen}>
      <DialogContent showCloseButton={false} className="kanban-archive-panel translate-x-0 translate-y-0" onInteractOutside={(event) => { if (!mobile) event.preventDefault(); }} onEscapeKeyDown={(event) => { if (detailEntry || confirm) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }}>
        <DialogHeader className="flex-row items-center justify-between gap-3 px-4 pb-3 pt-4 text-left">
          <DialogTitle className="text-base">Archived cards</DialogTitle><DialogDescription className="sr-only">Archived cards in {boardName}</DialogDescription>
          <Button variant="ghost" size="icon" aria-label="Close archive" disabled={working !== null} onClick={() => changeOpen(false)}><X className="size-5" aria-hidden="true" /></Button>
        </DialogHeader>
        <div className="px-4 pb-1"><Input ref={searchRef} aria-label="Search archived cards" placeholder="Search archived cards…" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); loadedCount.current = 50; closeDetail(); if (scrollRef.current) scrollRef.current.scrollTop = 0; }} /></div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {error && <div role="alert" className="my-4 rounded-lg border p-3 text-sm"><p>{error}</p><Button variant="ghost" onClick={() => setRefresh((value) => value + 1)}>Refresh archive</Button></div>}
          {searching && <p role="status" className="py-4 text-sm text-muted-foreground">Loading…</p>}
          {detailEntry && !detail && <p role="status" className="py-2 text-sm">Opening card…</p>}
          {!searching && !error && !items.length && <p className="py-10 text-center text-sm text-muted-foreground">{query ? "No matching cards" : "No archived cards"}</p>}
          {loadedQuery === query && <ul aria-label="Archived cards" className="space-y-3">{items.map((card, index) => <li key={card.deletionId}>
              {(index === 0 || archiveGroup(items[index - 1].archivedAt) !== archiveGroup(card.archivedAt)) && <h3 className="mb-2 mt-5 text-xs font-semibold text-muted-foreground">{archiveGroup(card.archivedAt)}</h3>}
              <button type="button" className="task-card archive-card" data-archive-id={card.deletionId} data-task-color={card.color || undefined} onClick={openCard}>
                <span className="archive-card-title">{card.title || "Untitled card"}</span>
                <span className="text-xs text-muted-foreground">{lists.find((list) => list.id === card.listId)?.name ?? "Original list removed"}</span>
              </button>
              <div className="archive-card-actions">
                <button type="button" disabled={working !== null} onClick={() => restore(card)} aria-label={`Restore ${card.title || "untitled card"}`}>{working === card.id ? "Saving…" : "Restore"}</button>
                {canPurge && <button type="button" disabled={working !== null} onClick={() => setConfirm({ kind: "card", card })} aria-label={`Delete ${card.title || "untitled card"}`}>Delete</button>}
              </div>
              {destination?.id === card.id && <div className="my-2 space-y-3 rounded-lg border p-3">
                <label className="grid gap-2 text-sm">Original list removed. Restore to<select className="h-10 min-w-0 rounded border bg-background px-2" aria-label="Restore to list" value={destinationListId} onChange={(event) => setDestinationListId(event.target.value)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>
                <div className="flex gap-2"><Button disabled={!destinationListId || working !== null} onClick={() => void recover(card, false, destinationListId)}>Restore card</Button><Button variant="ghost" onClick={() => setDestination(null)}>Cancel</Button></div>
              </div>}
            </li>)}</ul>}
          {cursor && !error && <Button variant="ghost" className="mt-4 w-full" disabled={searching} onClick={() => void more()}>Show more</Button>}
        </div>
        <div className="border-t px-4 py-2">
          {announcement && <p role="status" className="py-1 text-xs text-muted-foreground">{announcement}</p>}
          {canPurge && <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={working !== null || (!query && !items.length && !error)} onClick={() => void prepareDeleteAll()}>{working === "all" ? "Please wait…" : "Delete all archived cards"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
    <TaskDetailDialog task={detail} lists={lists} position={null} onClose={closeDetail} onUpdate={() => {}} onDelete={() => {}} onMoveWithinList={() => {}} archived={detailEntry ? { at: detailEntry.archivedAt, busy: working !== null, returnFocus: focusCard, onRestore: () => restore(detailEntry), ...(canPurge ? { onDelete: () => setConfirm({ kind: "card", card: detailEntry }) } : {}) } : undefined} />
    <ConfirmDialog open={confirm !== null} title={confirm?.kind === "all" ? "Delete all archived cards?" : "Delete card permanently?"} message={confirm?.kind === "all" ? `Permanently delete all ${confirm.count} archived cards in “${boardName}”, including cards hidden by search. Active cards stay on the board. This cannot be undone.` : `Permanently delete “${confirm?.card.title || "Untitled card"}”? This cannot be undone.`} confirmLabel={confirm?.kind === "all" ? `Delete ${confirm.count} archived cards` : "Delete permanently"} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm?.kind === "all") void deleteAll(confirm.revision); else if (confirm) void recover(confirm.card, true); setConfirm(null); }} />
  </>;
}
