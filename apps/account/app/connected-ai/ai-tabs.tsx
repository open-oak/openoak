"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./page.module.css";

type Tab = "setup" | "services";

export function AiTabs({ initialTab, setup, services }: { initialTab: Tab; setup: ReactNode; services: ReactNode }) {
  const [active, setActive] = useState(initialTab);
  const buttons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  function select(tab: Tab) {
    setActive(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }
  return <>
    <div className={styles.tabs} role="tablist" aria-label="AI connections">
      {(["setup", "services"] as const).map((tab) => <button
        key={tab} ref={(button) => { buttons.current[tab] = button; }}
        type="button" role="tab" id={`tab-${tab}`} aria-controls={`panel-${tab}`}
        aria-selected={active === tab} tabIndex={active === tab ? 0 : -1}
        onClick={() => select(tab)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "setup" : event.key === "End" ? "services" : active === "setup" ? "services" : "setup";
          select(next);
          buttons.current[next]?.focus();
        }}
      >{tab === "setup" ? "Setup" : "Connected services"}</button>)}
    </div>
    <div role="tabpanel" id="panel-setup" aria-labelledby="tab-setup" hidden={active !== "setup"}>{setup}</div>
    <div role="tabpanel" id="panel-services" aria-labelledby="tab-services" hidden={active !== "services"}>{services}</div>
  </>;
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button type="button" className={styles.copyButton} disabled={status === "copying"} aria-live="polite" onClick={async () => {
    clearTimeout(timer.current);
    setStatus("copying");
    try { await navigator.clipboard.writeText(value); setStatus("copied"); }
    catch { setStatus("failed"); }
    timer.current = setTimeout(() => setStatus("idle"), 1600);
  }}>{status === "copied" ? "Copied" : status === "failed" ? "Copy failed" : label}</button>;
}
