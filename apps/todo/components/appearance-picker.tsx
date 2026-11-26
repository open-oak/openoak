"use client";

import { Check, Sun, Moon, Monitor } from "lucide-react";
import { useState, useTransition, useEffect } from "react";
import { updateTheme, updateBackground } from "@/app/actions";
import { useRouter } from "next/navigation";
import { cn, parseBackground, encodeBackground, getBackgroundWithStaticBlur } from "@/lib/utils";
import type { SmartListType } from "@/lib/types";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SheetHandle, SheetMenuScrollArea, bottomSheetContentClass } from "@/components/sheet-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppStore } from "@/store/app-store";

type ColorMode = "auto" | "light" | "dark";

interface ThemeColor {
  value: string;
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

const BACKGROUNDS = [
  { id: "wp1", value: "url('/1.webp') center/cover no-repeat", preview: "/1-thumb.webp" },
  { id: "wp2", value: "url('/2.webp') center/cover no-repeat", preview: "/2-thumb.webp" },
  { id: "wp3", value: "url('/3.webp') center/cover no-repeat", preview: "/3-thumb.webp" },
  { id: "wp4", value: "url('/4.webp') center/cover no-repeat", preview: "/4-thumb.webp" },
  { id: "wp5", value: "url('/5.webp') center/cover no-repeat", preview: "/5-thumb.webp" },
  { id: "wp6", value: "url('/6.webp') center/cover no-repeat", preview: "/6-thumb.webp" },
  { id: "wp7", value: "url('/7.webp') center/cover no-repeat", preview: "/7-thumb.webp" },
  { id: "wp8", value: "url('/8.webp') center/cover no-repeat", preview: "/8-thumb.webp" },
  { id: "wp9", value: "url('/9.webp') center/cover no-repeat", preview: "/9-thumb.webp" },
  { id: "wp10", value: "url('/10.webp') center/cover no-repeat", preview: "/10-thumb.webp" },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
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

const sectionLabel = "text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-3 px-0.5";

export default function AppearancePicker({
  currentTheme,
  currentBg,
  listId,
  smartListType,
  open,
  onOpenChange,
  anchor,
}: {
  currentTheme?: string | null;
  currentBg?: string | null;
  listId?: string;
  smartListType?: SmartListType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor?: { top: number; right: number } | null;
}) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const isMobile = useIsMobile();
  const setWallpaper = useAppStore((s) => s.setWallpaper);
  const setCurrentPageTheme = useAppStore((s) => s.setCurrentPageTheme);
  const colorMode = useAppStore((s) => s.colorMode);
  const setColorMode = useAppStore((s) => s.setColorMode);
  const glassEnabled = useAppStore((s) => s.glassEnabled);
  const setGlassEnabled = useAppStore((s) => s.setGlassEnabled);

  // For UI swatches, we need to know if we're "effectively" dark
  const [isDarkUI, setIsDarkUI] = useState(false);

  const { bg: activeBgValue, blur: activeBlur } = parseBackground(currentBg);
  const activeBlurEnabled = activeBlur > 0;

  // Local optimistic state — updates immediately so picker UI and wallpaper respond without waiting for router.refresh()
  const activeThemeValue = currentTheme || "default";
  const [backgroundSelection, setBackgroundSelection] = useState(() => ({
    base: activeBgValue,
    value: activeBgValue,
  }));
  const [themeSelection, setThemeSelection] = useState(() => ({
    base: activeThemeValue,
    value: activeThemeValue,
  }));
  const [blurSelection, setBlurSelection] = useState(() => ({
    base: activeBlurEnabled,
    value: activeBlurEnabled,
  }));
  const localBgValue =
    backgroundSelection.base === activeBgValue ? backgroundSelection.value : activeBgValue;
  const localTheme =
    themeSelection.base === activeThemeValue ? themeSelection.value : activeThemeValue;
  const isBlurEnabled =
    blurSelection.base === activeBlurEnabled ? blurSelection.value : activeBlurEnabled;

  const hasWallpaper = Boolean(localBgValue) && localBgValue !== "none";

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      if (colorMode === "dark") setIsDarkUI(true);
      else if (colorMode === "light") setIsDarkUI(false);
      else setIsDarkUI(mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [colorMode]);

  // Apply a wallpaper value immediately to PersistentBackground
  const applyWallpaperNow = (bgValue: string, blur: boolean) => {
    const { bg, blur: b } = parseBackground(encodeBackground(bgValue, blur ? 1 : 0));
    setWallpaper(getBackgroundWithStaticBlur(bg, b));
  };

  const handleColorMode = (mode: ColorMode) => {
    setColorMode(mode);
  };

  const handleSelectTheme = (color: ThemeColor) => {
    // Immediate visual update
    setThemeSelection({ base: activeThemeValue, value: color.value });
    setBackgroundSelection({ base: activeBgValue, value: "none" });
    setWallpaper(null);
    setCurrentPageTheme(color.value !== "default" ? color.value : null);
    startTransition(async () => {
      await updateBackground(encodeBackground("none", 0), listId, smartListType);
      await updateTheme(color.value, listId, smartListType);
      router.refresh();
    });
  };

  const handleSelectBg = (bgValue: string) => {
    // Immediate visual update — reset theme to "default" so colour doesn't cover the wallpaper
    setBackgroundSelection({ base: activeBgValue, value: bgValue });
    setThemeSelection({ base: activeThemeValue, value: "default" });
    setCurrentPageTheme(null);
    applyWallpaperNow(bgValue, isBlurEnabled);
    startTransition(async () => {
      const encoded = encodeBackground(bgValue, isBlurEnabled ? 1 : 0);
      await updateBackground(encoded, listId, smartListType);
      await updateTheme("default", listId, smartListType);
      router.refresh();
    });
  };

  const handleBlurToggle = (enabled: boolean) => {
    setBlurSelection({ base: activeBlurEnabled, value: enabled });
    if (localBgValue && localBgValue !== "none") applyWallpaperNow(localBgValue, enabled);
    startTransition(async () => {
      await updateBackground(encodeBackground(localBgValue, enabled ? 1 : 0), listId, smartListType);
      router.refresh();
    });
  };

  const getSwatchColor = (color: ThemeColor): string => {
    if (color.value === "default") return "";
    return isDarkUI ? color.darkColor : color.lightColor;
  };

  const activeTheme = localTheme;

  const pickerBody = (
    <>
      {/* Mode */}
      <p className={sectionLabel}>Mode</p>
      <div className="flex gap-1 mb-5 bg-muted/60 rounded-xl p-1">
        {([
          { mode: "light" as const, icon: Sun, label: "Light" },
          { mode: "dark" as const, icon: Moon, label: "Dark" },
          { mode: "auto" as const, icon: Monitor, label: "Auto" },
        ]).map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => handleColorMode(mode)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all",
              colorMode === mode
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Theme */}
      <p className={sectionLabel}>Theme</p>
      <div className="grid grid-cols-6 gap-2.5 mb-5">
        {THEME_COLORS.map((color) => {
          const isActive = (!localBgValue || localBgValue === "none") && activeTheme === color.value;
          return (
            <button
              key={color.value}
              onClick={() => handleSelectTheme(color)}
              className={cn(
                "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all hover:scale-125 active:scale-95 shadow-sm mx-auto",
                isActive ? "border-foreground ring-1 ring-foreground" : "border-border"
              )}
              style={
                color.value === "default"
                  ? { background: "var(--background)" }
                  : { backgroundColor: getSwatchColor(color) }
              }
              title={color.label}
            >
              {isActive && <Check className="w-3.5 h-3.5 text-foreground opacity-70" />}
            </button>
          );
        })}
      </div>

      {/* Wallpaper */}
      <p className={sectionLabel}>Wallpaper</p>
      <div className="grid grid-cols-3 gap-2">
        {BACKGROUNDS.map((bg) => (
          <button
            key={bg.id}
            onClick={() => handleSelectBg(bg.value)}
            className={cn(
              "h-16 rounded-xl border-2 flex items-center justify-center transition-all hover:scale-105 active:scale-95 relative overflow-hidden",
              localBgValue === bg.value ? "border-foreground ring-1 ring-foreground" : "border-border"
            )}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 scale-150 bg-cover bg-center"
              style={{ backgroundImage: `url('${bg.preview}')` }}
            />
            {localBgValue === bg.value && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Check className="w-5 h-5 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Toggles */}
      <div className="mt-4 pt-4 border-t border-border/50 flex flex-col gap-3">
        {hasWallpaper && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Wallpaper Blur</span>
            <Toggle checked={isBlurEnabled} onChange={handleBlurToggle} />
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Transparent UI</span>
          <Toggle checked={glassEnabled} onChange={setGlassEnabled} />
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile bottom sheet — only mounted on mobile so the portal doesn't interfere on desktop ── */}
      {isMobile && (
        <Sheet open={open} onOpenChange={onOpenChange}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            overlayClassName="!bg-transparent"
            className={bottomSheetContentClass("max-h-[80dvh] pb-0")}
          >
            <SheetTitle className="sr-only">Theme &amp; appearance</SheetTitle>
            <SheetHandle />
            <SheetMenuScrollArea className="flex-1 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {pickerBody}
            </SheetMenuScrollArea>
          </SheetContent>
        </Sheet>
      )}

      {/* ── Desktop floating panel ── */}
      {!isMobile && open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div
            className="fixed z-50 w-[272px] p-4 rounded-2xl bg-card/95 shadow-2xl ring-1 ring-border/60 animate-in zoom-in-95 slide-in-from-top-2 duration-150 overflow-y-auto max-h-[calc(100dvh-5rem)]"
            style={anchor ? { top: anchor.top + 8, right: anchor.right } : { top: 80, right: 32 }}
          >
            {pickerBody}
          </div>
        </>
      )}
    </>
  );
}
