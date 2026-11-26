"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const CLOSE_ANIMATION_MS = 200;

export function MobileOverlay({
  children,
  onClose,
}: {
  children: (requestClose: () => void) => ReactNode;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const onCloseRef = useRef(onClose);
  const requestClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open) return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : CLOSE_ANIMATION_MS;
    const timeout = window.setTimeout(() => onCloseRef.current(), delay);
    return () => window.clearTimeout(timeout);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(); }}>
      <SheetContent
        side="left"
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="!bg-black/25 !duration-200"
        className="notes-mobile-sheet !w-full !max-w-none border-0 bg-transparent shadow-none !duration-200 !ease-out data-[side=left]:data-open:slide-in-from-left-full data-[side=left]:data-closed:slide-out-to-left-full md:hidden"
      >
        <SheetTitle className="sr-only">OpenOutline navigation</SheetTitle>
        <div className="min-h-0 flex-1 [&>*]:h-full">{children(requestClose)}</div>
      </SheetContent>
    </Sheet>
  );
}
