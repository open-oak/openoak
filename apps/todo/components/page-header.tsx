"use client";

import { Check } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAppStore } from "@/store/app-store";
import { cn, parseBackground } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  titleText: string;
  currentBg?: string | null;
  currentTheme?: string | null;
  headerScrollTop?: number;
  renderActions: (buttonClassName: string) => React.ReactNode;
  subtitle?: React.ReactNode;
}

export default function PageHeader({
  title,
  titleText,
  currentBg,
  currentTheme,
  headerScrollTop = 0,
  renderActions,
  subtitle,
}: PageHeaderProps) {
  const { bg: bgImage } = parseBackground(currentBg);
  const hasWallpaper = Boolean(bgImage) && bgImage !== "none";
  const isDefaultTheme = !currentTheme || currentTheme === "default";
  const glassEnabled = useAppStore((s) => s.glassEnabled);
  const isSaving = useAppStore((s) => Object.keys(s.pendingTaskMutations).length > 0);
  const [actionsInside, setActionsInside] = useState(false);
  const headerContentRef = useRef<HTMLDivElement>(null);
  const floatingActionsRef = useRef<HTMLDivElement>(null);

  const mobileTitleSizeClass =
    titleText.length <= 14
      ? "text-4xl"
      : titleText.length <= 18
      ? "text-[1.85rem]"
      : titleText.length <= 22
      ? "text-[1.72rem]"
      : titleText.length <= 26
      ? "text-[1.58rem]"
      : "text-[1.46rem]";

  const titleClass = cn(
    mobileTitleSizeClass,
    "md:text-5xl font-semibold leading-none",
    hasWallpaper
      ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.72)]"
      : isDefaultTheme
      ? "text-black dark:text-white"
      : "text-foreground"
  );

  const actionSurfaceClass = cn("rounded-xl h-11 flex items-center justify-center border-none text-foreground transition-colors duration-200 md:h-10",
    glassEnabled ? "bg-card/[0.75]" : "bg-card"
  );
  const buttonClass = cn(actionSurfaceClass, "w-11 p-0 hover:bg-card md:w-10");
  const bannerOpacity = Math.min(Math.max(headerScrollTop, 0) / 56, 1) * 0.65;

  useLayoutEffect(() => {
    const content = headerContentRef.current;
    const floating = floatingActionsRef.current;
    if (!content || !floating) return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!window.matchMedia("(min-width: 768px)").matches) {
          setActionsInside(false);
          return;
        }
        const contentRect = content.getBoundingClientRect();
        const floatingRect = floating.getBoundingClientRect();
        const shouldMoveInside = floatingRect.left < contentRect.right + 8;
        setActionsInside((current) => current === shouldMoveInside ? current : shouldMoveInside);
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(floating);
    window.addEventListener("resize", measure);
    measure();

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isSaving]);

  const renderActionCluster = () => (
    <>
      <SaveIndicator isSaving={isSaving} className={actionSurfaceClass} />
      {renderActions(buttonClass)}
    </>
  );

  return (
    <>
      <header className="relative shrink-0 px-4 pt-3 pb-1 md:px-8 md:pt-8 md:pb-4">
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-36 border-b md:hidden",
            hasWallpaper ? "bg-black border-white/20" : "bg-background border-border/70"
          )}
          style={{
            opacity: bannerOpacity,
            transition: "opacity 220ms ease",
          }}
        />

        <div ref={headerContentRef} className="relative z-10 max-w-4xl mx-auto w-full grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 md:gap-4">
          <div className="col-start-1 row-start-1 flex items-center justify-self-start">
            <SidebarTrigger className={cn(buttonClass, "md:hidden")} />
          </div>

          <h1
            className={cn(
              titleClass,
              "col-span-3 row-start-2 mt-2 md:col-span-1 md:col-start-2 md:row-start-1 md:mt-0 justify-self-center min-w-0 w-full md:max-w-[48rem] text-center overflow-hidden"
            )}
          >
            {title}
          </h1>

          {actionsInside && (
            <div className="col-start-3 row-start-1 hidden items-center justify-self-end gap-2 md:flex">
              {renderActionCluster()}
            </div>
          )}
        </div>

        <div
          ref={floatingActionsRef}
          aria-hidden={actionsInside ? true : undefined}
          className={cn("absolute right-4 top-3 z-10 flex items-center gap-2 md:top-4", actionsInside && "invisible")}
        >
          {renderActionCluster()}
        </div>
      </header>

      {subtitle && (
        <div className="px-4 md:px-8 pb-2">
          <div className="max-w-4xl mx-auto w-full">
            {subtitle}
          </div>
        </div>
      )}
    </>
  );
}

function SaveIndicator({ isSaving, className }: { isSaving: boolean; className: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(className, "hidden min-w-[5.625rem] gap-2 px-3 text-xs font-semibold text-muted-foreground md:inline-flex")}
    >
      {isSaving ? (
        <span className="size-2 animate-pulse rounded-full bg-primary" />
      ) : (
        <Check className="size-3.5" />
      )}
      {isSaving ? "Saving" : "Saved"}
    </div>
  );
}
