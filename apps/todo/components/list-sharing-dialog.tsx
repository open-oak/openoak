"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Copy, Link2, LogOut, RefreshCw, ShieldCheck, UserMinus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  disableListInvite,
  enableListInvite,
  getListSharing,
  leaveSharedList,
  removeListMember,
  rotateListInvite,
  type ListSharingDetails,
} from "@/app/sharing-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/app-store";
import { toast } from "sonner";

export function ListSharingDialog({
  listId,
  open,
  onOpenChange,
  onClosedFocus,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosedFocus?: () => void;
}) {
  const router = useRouter();
  const lists = useAppStore((state) => state.lists);
  const setLists = useAppStore((state) => state.setLists);
  const [details, setDetails] = useState<ListSharingDetails | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const next = await getListSharing(listId);
    setDetails(next);
  }, [listId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getListSharing(listId).then((next) => {
      if (!cancelled) setDetails(next);
    });
    return () => {
      cancelled = true;
    };
  }, [listId, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setDetails(null);
    onOpenChange(nextOpen);
  };

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error || "This list is unavailable.");
      else await refresh();
      router.refresh();
    });
  };

  const copyInvite = async () => {
    if (!details?.ok || !details.invitePath) return;
    await navigator.clipboard.writeText(new URL(details.invitePath, window.location.origin).toString());
    toast.success("Invite link copied");
  };

  const leave = () => {
    const previous = lists;
    setLists(lists.filter((list) => list.id !== listId));
    handleOpenChange(false);
    router.push("/tasks");
    startTransition(async () => {
      const result = await leaveSharedList(listId);
      if (!result.ok) {
        setLists(previous);
        toast.error(result.error);
      } else {
        toast.success("You left the shared list");
      }
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[min(80dvh,42rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosedFocus?.();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="size-5" /> Share list</DialogTitle>
          <DialogDescription>
            {details?.ok && details.accessLevel === "editor"
              ? `Owned by ${details.ownerDisplay}. You can edit tasks and list appearance.`
              : "Anyone with an active invite link can join as an editor."}
          </DialogDescription>
        </DialogHeader>

        {!details && <p className="py-6 text-sm text-muted-foreground" role="status">Loading sharing settings…</p>}
        {details && !details.ok && <p className="py-6 text-sm text-destructive" role="alert">{details.error}</p>}

        {details?.ok && details.accessLevel === "owner" && (
          <div className="space-y-5">
            <section className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Link2 className="size-4" /> Invite link</div>
              {details.inviteEnabled && details.invitePath ? (
                <>
                  <p className="break-all rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {new URL(details.invitePath, typeof window === "undefined" ? "https://todo.openoak.org" : window.location.origin).toString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={copyInvite} disabled={pending}><Copy /> Copy</Button>
                    <Button size="sm" variant="outline" onClick={() => run(() => rotateListInvite(listId))} disabled={pending}><RefreshCw /> Rotate</Button>
                    <Button size="sm" variant="outline" onClick={() => run(() => disableListInvite(listId))} disabled={pending}>Disable</Button>
                  </div>
                </>
              ) : (
                <Button size="sm" onClick={() => run(() => enableListInvite(listId))} disabled={pending}><Link2 /> Create invite link</Button>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4" /> Members</div>
              {details.members.length === 0 ? (
                <p className="rounded-xl border p-3 text-sm text-muted-foreground">Only you have access.</p>
              ) : details.members.map((member) => (
                <div key={member.userId} className="flex items-center gap-3 rounded-xl border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.displayName}</p>
                    {member.email && member.email !== member.displayName && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${member.displayName}`}
                    disabled={pending}
                    onClick={() => run(() => removeListMember(listId, member.userId))}
                  ><UserMinus /></Button>
                </div>
              ))}
            </section>
          </div>
        )}

        {details?.ok && details.accessLevel === "editor" && (
          <div className="space-y-4">
            <div className="rounded-xl border p-3 text-sm">
              <p className="font-medium">Editor access</p>
              <p className="mt-1 text-muted-foreground">You can rename this list, change its appearance, and edit its tasks. Only the owner manages members and deletion.</p>
            </div>
            <Button variant="destructive" onClick={leave} disabled={pending}><LogOut /> Leave list</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
