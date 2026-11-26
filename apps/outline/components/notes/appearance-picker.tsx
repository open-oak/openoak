"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AccentColor, NotesSettings } from "@/lib/types";
import { WALLPAPERS } from "./constants";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SheetHandle, SheetMenuScrollArea, bottomSheetContentClass } from "@/components/sheet-menu";
import { useIsMobile } from "@/hooks/use-mobile";

interface ThemeColor {
  value: AccentColor;
  label: string;
  lightColor: string;
  darkColor: string;
}

const THEME_COLORS: ThemeColor[] = [
  { value: "default", label: "Default", lightColor: "", darkColor: "" },
  { value: "blue", label: "Blue", lightColor: "#bfdbfe", darkColor: "#1e3a5f" },
  { value: "purple", label: "Purple", lightColor: "#ddd6fe", darkColor: "#2d2450" },
  { value: "coral", label: "Coral", lightColor: "#fecaca", darkColor: "#452828" },
  { value: "green", label: "Green", lightColor: "#bbf7d0", darkColor: "#1e3525" },
  { value: "gold", label: "Gold", lightColor: "#fde68a", darkColor: "#3d301a" },
];

const sectionLabel = "mb-3 px-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200",
        checked ? "bg-foreground" : "bg-border"
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

export function AppearancePicker({
  settings,
  open,
  onOpenChange,
  onPatch,
  anchor,
}: {
  settings: NotesSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatch: (patch: Partial<NotesSettings>) => void;
  anchor?: { top: number; right: number } | null;
}) {
  const isMobile = useIsMobile();
  const [isDarkUI, setIsDarkUI] = useState(false);
  const hasWallpaper = settings.wallpaper !== "none";

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (settings.colorMode === "dark") setIsDarkUI(true);
      else if (settings.colorMode === "light") setIsDarkUI(false);
      else setIsDarkUI(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [settings.colorMode]);

  const selectTheme = (theme: AccentColor) => {
    onPatch({ accentColor: theme, wallpaper: "none", wallpaperBlur: false });
  };

  const selectWallpaper = (wallpaper: NotesSettings["wallpaper"]) => {
    onPatch({ accentColor: "default", wallpaper });
  };

  const pickerBody = (
    <>
      <p className={sectionLabel}>Mode</p>
      <div className="mb-5 flex gap-1 rounded-xl bg-muted/60 p-1">
        {([
          { mode: "light" as const, icon: Sun, label: "Light" },
          { mode: "dark" as const, icon: Moon, label: "Dark" },
          { mode: "auto" as const, icon: Monitor, label: "Auto" },
        ]).map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onPatch({ colorMode: mode })}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 !text-xs font-medium transition-all",
              settings.colorMode === mode
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <p className={sectionLabel}>Theme</p>
      <div className="mb-5 grid grid-cols-6 gap-2.5">
        {THEME_COLORS.map((color) => {
          const active = !hasWallpaper && settings.accentColor === color.value;
          return (
            <button
              key={color.value}
              type="button"
              onClick={() => selectTheme(color.value)}
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-sm transition-all hover:scale-125 active:scale-95",
                active ? "border-foreground ring-1 ring-foreground" : "border-border"
              )}
              style={color.value === "default" ? { background: "var(--background)" } : { backgroundColor: isDarkUI ? color.darkColor : color.lightColor }}
              title={color.label}
              aria-label={`${color.label} theme`}
              aria-pressed={active}
            >
              {active && <Check className="h-3.5 w-3.5 text-foreground opacity-70" />}
            </button>
          );
        })}
      </div>

      <p className={sectionLabel}>Wallpaper</p>
      <div className="grid grid-cols-3 gap-2">
        {WALLPAPERS.filter((wallpaper) => wallpaper.id !== "none").map((wallpaper) => (
          <button
            key={wallpaper.id}
            type="button"
            onClick={() => selectWallpaper(wallpaper.id)}
            className={cn(
              "relative flex h-16 items-center justify-center overflow-hidden rounded-xl border-2 transition-all hover:scale-105 active:scale-95",
              settings.wallpaper === wallpaper.id ? "border-foreground ring-1 ring-foreground" : "border-border"
            )}
            aria-label={`${wallpaper.label} wallpaper`}
            aria-pressed={settings.wallpaper === wallpaper.id}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 scale-150 bg-cover bg-center"
              style={{ backgroundImage: `url('${wallpaper.thumb}')` }}
            />
            {settings.wallpaper === wallpaper.id && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Check className="h-5 w-5 text-white" />
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border/50 pt-4">
        {hasWallpaper && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Wallpaper Blur</span>
            <Toggle checked={settings.wallpaperBlur} onChange={(wallpaperBlur) => onPatch({ wallpaperBlur })} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Transparent UI</span>
          <Toggle checked={settings.glassEnabled} onChange={(glassEnabled) => onPatch({ glassEnabled })} />
        </div>
      </div>
    </>
  );

  return (
    <>
      {isMobile && (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" showCloseButton={false} overlayClassName="!bg-transparent" className={bottomSheetContentClass("!bg-[var(--notes-panel-solid)] max-h-[80dvh] pb-0")}>
            <SheetTitle className="sr-only">Theme &amp; appearance</SheetTitle>
            <SheetHandle />
            <SheetMenuScrollArea className="flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{pickerBody}</SheetMenuScrollArea>
          </SheetContent>
        </Sheet>
      )}

      {!isMobile && open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div
            className="fixed z-50 max-h-[calc(100dvh-5rem)] w-[272px] overflow-y-auto rounded-2xl bg-[var(--notes-panel-solid)] p-4 shadow-2xl ring-1 ring-border/60 animate-in zoom-in-95 slide-in-from-top-2 duration-150"
            style={anchor ? { top: anchor.top + 8, right: anchor.right } : { top: 80, right: 32 }}
          >
            {pickerBody}
          </div>
        </>
      )}
    </>
  );
}
