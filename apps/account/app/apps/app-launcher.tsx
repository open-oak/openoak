"use client";

import type { MouseEvent } from "react";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";

type AppItem = {
  name: string;
  href: string;
  icon: string;
};

function shouldLetBrowserHandle(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function AppLauncher({ apps }: { apps: AppItem[] }) {
  const [launchingApp, setLaunchingApp] = useState<string | null>(null);

  function handleLaunch(event: MouseEvent<HTMLAnchorElement>, app: AppItem) {
    if (shouldLetBrowserHandle(event)) return;

    event.preventDefault();
    setLaunchingApp(app.name);

    window.setTimeout(() => {
      window.location.assign(app.href);
    }, 80);
  }

  return (
    <div className="flex w-full flex-col items-center">
      <div className="grid w-full max-w-4xl grid-cols-3 items-start justify-items-center gap-4 sm:gap-10">
        {apps.map((app) => {
          const isLaunching = launchingApp === app.name;

          return (
            <a
              key={app.name}
              href={app.href}
              aria-busy={isLaunching || undefined}
              onClick={(event) => handleLaunch(event, app)}
              className="group flex w-full max-w-44 flex-col items-center gap-4 text-center text-white outline-none"
            >
              <span className="inline-flex size-20 items-center justify-center transition-transform duration-200 group-hover:-translate-y-1 group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none sm:size-24">
                {isLaunching ? (
                  <LoaderCircle className="size-10 animate-spin text-[#f6f3ee] motion-reduce:animate-none sm:size-12" strokeWidth={1.8} aria-hidden />
                ) : (
                  <span className="text-5xl leading-none sm:text-7xl" aria-hidden>
                    {app.icon}
                  </span>
                )}
              </span>
              <span className="text-base font-semibold tracking-normal text-[#f6f3ee] drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] group-focus-visible:underline sm:text-xl">
                {app.name}
              </span>
            </a>
          );
        })}
      </div>

      {launchingApp && (
        <div className="fixed inset-x-4 bottom-6 z-20 mx-auto flex max-w-sm items-center justify-center gap-3 rounded-full border border-white/16 bg-[#101815]/94 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_70px_rgba(0,0,0,0.36)]" role="status" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Opening {launchingApp}
        </div>
      )}
    </div>
  );
}
