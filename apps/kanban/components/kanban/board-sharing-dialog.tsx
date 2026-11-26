"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Person = { id: string; name: string };
type Sharing = { accessLevel: "owner" | "editor"; owner: Person; members: Person[]; invitePath: string | null; nextMember: string | null };
export function BoardSharingDialog({ accountId, boardKey, boardName, open, onOpenChange, onChanged, onReturnFocus }: {
  accountId: string; boardKey: string; boardName: string; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void; onReturnFocus: () => void;
}) {
  const [data, setData] = useState<Sharing | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const request = useCallback(async (action?: string, memberId?: string, after?: string) => {
    const response = await fetch(action ? "/api/kanban/sharing" : `/api/kanban/sharing?boardKey=${encodeURIComponent(boardKey)}${after ? `&after=${encodeURIComponent(after)}` : ""}`, {
      method: action ? "POST" : "GET", headers: { "content-type": "application/json", "x-openkanban-account": accountId },
      ...(action ? { body: JSON.stringify({ action, boardKey, ...(memberId ? { memberId } : {}) }) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "Unable to update sharing.");
    return result as Sharing;
  }, [accountId, boardKey]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    request().then((result) => { if (active) { setData(result); setNotice(""); } }).catch((error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [open, request]);
  const change = async (action: string, memberId?: string) => {
    setBusy(true); setNotice("");
    try {
      await request(action, memberId);
      if (action === "leave") onOpenChange(false);
      else setData(await request());
      onChanged();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const owner = data?.accessLevel === "owner";
  const inviteUrl = data?.invitePath && typeof window !== "undefined" ? new URL(data.invitePath, window.location.origin).toString() : "";
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); onReturnFocus(); }} className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    <DialogHeader><DialogTitle>Share board</DialogTitle><DialogDescription>{boardName}</DialogDescription></DialogHeader>
    {!data ? <p className="text-sm">{notice || "Loading sharing…"}</p> : <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{owner ? "Invite people to edit this board with you. Only you can manage access or delete the board." : `${data.owner.name} owns this board. You can edit its lists and cards.`}</p>
      {owner && <section className="space-y-3" aria-label="Invite link">
        {inviteUrl ? <>
          <label className="block text-sm font-medium" htmlFor="board-invite-link">Invite link</label>
          <input id="board-invite-link" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setNotice("Link copied."); } catch { setNotice("Select and copy the link above."); } }}>Copy link</Button>
            <Button variant="outline" disabled={busy} onClick={() => void change("rotate")}>Replace link</Button>
            <Button variant="outline" disabled={busy} onClick={() => void change("disable")}>Disable link</Button>
          </div>
          <p className="text-xs text-muted-foreground">Anyone with the link can choose to join. Replacing or disabling it keeps current members.</p>
        </> : <><Button disabled={busy} onClick={() => void change("enable")}>Create invite link</Button><p className="text-xs text-muted-foreground">No active invite link. Current members still have access.</p></>}
      </section>}
      <section className="space-y-3" aria-label="Board members">
        <h3 className="text-sm font-medium">People with access</h3>
        <div className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 break-words">{data.owner.name}{owner ? " (you)" : ""}</span><span className="text-muted-foreground">Owner</span></div>
        {owner ? <>
          {data.members.map((person) => <div key={person.id} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 break-words">{person.name}<span className="ml-2 text-xs text-muted-foreground">Editor</span></span><Button size="sm" variant="outline" disabled={busy} onClick={() => void change("remove", person.id)} aria-label={`Remove ${person.name}`}>Remove</Button></div>)}
          {!data.members.length && <p className="text-sm text-muted-foreground">Only you so far.</p>}
          {data.nextMember && <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const next = await request(undefined, undefined, data.nextMember!); setData({ ...next, members: [...data.members, ...next.members] }); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load members."); } finally { setBusy(false); } }}>Show more members</Button>}
          <p className="text-xs text-muted-foreground">A removed member can join again with an active link. Replace or disable the link to prevent that.</p>
        </> : <><div className="flex justify-between text-sm"><span>You</span><span className="text-muted-foreground">Editor</span></div><Button variant="outline" disabled={busy} onClick={() => void change("leave")}>Leave board</Button></>}
      </section>
    </div>}
    {notice && data && <p role="status" className="text-sm">{notice}</p>}
  </DialogContent></Dialog>;
}
