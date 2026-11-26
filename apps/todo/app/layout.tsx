import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeObserver } from "@/components/theme-observer";
import { pwaMetadata } from "../../../shared/pwa/metadata";
import { PwaControls } from "../../../shared/pwa/pwa-controls";
import "../../../shared/pwa/pwa.css";
import "./globals.css";

const appUrl =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  ...pwaMetadata("todo"),
  metadataBase: new URL(appUrl),
  title: "OpenTodo",
  description: "A self-hostable task app optimized for desktop and mobile.",
  openGraph: {
    title: "OpenTodo",
    description: "A self-hostable task app optimized for desktop and mobile.",
    url: appUrl,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "OpenTodo",
    description: "A self-hostable task app optimized for desktop and mobile.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f5f5f5",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var mode = localStorage.getItem('theme-mode') || 'auto';
              var supportDark = window.matchMedia('(prefers-color-scheme:dark)').matches;
              if (mode === 'dark' || (mode === 'auto' && supportDark)) {
                document.documentElement.classList.add('dark');
                document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#1e1e1e');
              }
            }catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeObserver />
        {children}
        <PwaControls app="todo" />
      </body>
    </html>
  );
}
