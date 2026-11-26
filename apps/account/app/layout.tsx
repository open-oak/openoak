import type { Metadata, Viewport } from "next";
import { pwaMetadata, pwaThemeColor } from "../../../shared/pwa/metadata";
import { PwaControls } from "../../../shared/pwa/pwa-controls";
import "../../../shared/pwa/pwa.css";
import "./globals.css";

// The request CSP supplies a fresh nonce for the scripts that hydrate the PWA
// controls and account forms, including public recovery pages.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pwaMetadata("account"),
  title: "OpenOak Account",
  description: "Unified account management for OpenOak apps.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: pwaThemeColor,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">

      <body>{children}<PwaControls app="account" /></body>
    </html>
  );
}
