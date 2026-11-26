"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  icon,
  tone = "danger",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  icon?: React.ReactNode;
  tone?: "danger" | "neutral";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <AlertDialogContent className="bg-popover sm:max-w-[25rem]">
        <div className={cn("confirm-icon", tone === "neutral" && "confirm-icon-neutral")} aria-hidden="true">
          {icon || <Trash2 className="size-5" />}
        </div>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(tone === "danger" && "bg-destructive text-white hover:bg-destructive/90")}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
