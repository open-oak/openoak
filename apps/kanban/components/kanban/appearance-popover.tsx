"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SheetHandle, SheetMenuScrollArea, bottomSheetContentClass } from "@/components/sheet-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { themeOptions, wallpaperOptions, type ColorMode, type ThemeId, type WallpaperId } from "./constants";

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
      <span className={cn("inline-block h-5 w-5 rounded-full bg-background shadow transition-transform duration-200", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

export function AppearancePicker({
  theme,
  mode,
  wallpaper,
  wallpaperBlur,
  glass,
  open,
  onOpenChange,
  onThemeChange,
  onModeChange,
  onWallpaperChange,
  onWallpaperBlurChange,
  onGlassChange,
  anchor,
}: {
  theme: ThemeId;
  mode: ColorMode;
  wallpaper: WallpaperId;
  wallpaperBlur: boolean;
  glass: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (theme: ThemeId) => void;
  onModeChange: (mode: ColorMode) => void;
  onWallpaperChange: (wallpaper: WallpaperId) => void;
  onWallpaperBlurChange: (blur: boolean) => void;
  onGlassChange: (glass: boolean) => void;
  anchor?: { top: number; right: number } | null;
}) {
  const isMobile = useIsMobile();
  const hasWallpaper = wallpaper !== "none";

  const pickerBody = (
    <>
      <p className={sectionLabel}>Mode</p>
      <div className="mb-5 flex gap-1 rounded-xl bg-muted/60 p-1">
        {([
          { value: "light" as const, icon: Sun, label: "Light" },
          { value: "dark" as const, icon: Moon, label: "Dark" },
          { value: "auto" as const, icon: Monitor, label: "Auto" },
        ]).map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 !text-xs font-medium transition-all",
              mode === value ? "bg-card text-foreground shadow-sm ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <p className={sectionLabel}>Theme</p>
      <div className="mb-5 grid grid-cols-6 gap-2.5">
        {themeOptions.map((color) => {
          const active = !hasWallpaper && theme === color.id;
          return (
            <button
              key={color.id}
              type="button"
              onClick={() => onThemeChange(color.id)}
              className={cn(
                "theme-color-swatch mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-sm transition-all hover:scale-125 active:scale-95",
                active ? "border-foreground ring-1 ring-foreground" : "border-border"
              )}
              data-theme-color={color.id}
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
        {wallpaperOptions.filter((option) => option.id !== "none").map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onWallpaperChange(option.id)}
            className={cn(
              "relative flex h-16 items-center justify-center overflow-hidden rounded-xl border-2 transition-all hover:scale-105 active:scale-95",
              wallpaper === option.id ? "border-foreground ring-1 ring-foreground" : "border-border"
            )}
            aria-label={`${option.label} wallpaper`}
            aria-pressed={wallpaper === option.id}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 scale-150 bg-cover bg-center"
              style={{ backgroundImage: `url('/${option.id}-thumb.webp'), url('/${option.id}.webp')` }}
            />
            {wallpaper === option.id && (
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
            <Toggle checked={wallpaperBlur} onChange={onWallpaperBlurChange} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Transparent UI</span>
          <Toggle checked={glass} onChange={onGlassChange} />
        </div>
      </div>
    </>
  );

  return (
    <>
      {isMobile && (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent side="bottom" showCloseButton={false} overlayClassName="!bg-transparent" className={bottomSheetContentClass("!bg-[var(--solid-card)] max-h-[80dvh] pb-0")}>
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
            className="fixed z-50 max-h-[calc(100dvh-5rem)] w-[272px] overflow-y-auto rounded-2xl bg-[var(--solid-card)] p-4 shadow-2xl ring-1 ring-border/60 animate-in zoom-in-95 slide-in-from-top-2 duration-150"
            style={anchor ? { top: anchor.top + 8, right: anchor.right } : { top: 80, right: 32 }}
          >
            {pickerBody}
          </div>
        </>
      )}
    </>
  );
}
