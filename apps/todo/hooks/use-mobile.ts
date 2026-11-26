import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribeToViewport(onStoreChange: () => void) {
  const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  query.addEventListener("change", onStoreChange)
  return () => query.removeEventListener("change", onStoreChange)
}

function getViewportSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribeToViewport, getViewportSnapshot, () => false)
}
