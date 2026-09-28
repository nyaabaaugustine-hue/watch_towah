import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";

import { ServiceWorkerRegistration } from "@/components/app/service-worker-registration";
import { WatchtowerMark } from "@/components/brand/watchtower-mark";

import "./globals.css";

const displayFont = Archivo({
  subsets: ["latin"],
  weight: ["700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Watchtower — Your Safety. Our Priority.",
    template: "%s · Watchtower",
  },
  description:
    "Personal safety and family location monitoring for Ghana and beyond. Silent SOS, live location sharing, and journey monitoring that works on low-end phones and weak networks.",
  applicationName: "Watchtower",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Watchtower",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.webmanifest",
  // These paths are the ones `public/` actually contains. They previously
  // pointed at `/icons/icon-192.png` and `/icons/apple-touch-icon.png`, which
  // do not exist, so every browser request for the favicon or the iOS home
  // screen icon 404'd while the manifest, which is correct, kept working.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4B0FA8" },
    { media: "(prefers-color-scheme: dark)", color: "#260657" },
  ],
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom is disabled: the SOS control is a large target and accidental
  // two-finger zoom during an emergency is a real hazard. The OS-level
  // accessibility zoom path still works.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const RootLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <html lang="en-GH" className={`${displayFont.variable} ${bodyFont.variable}`}>
    <body>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-watchtower-800"
      >
        Skip to main content
      </a>
      <div id="main">{children}</div>
      <ServiceWorkerRegistration />
      <noscript>
        <div className="app-shell p-6 text-center">
          <WatchtowerMark className="mx-auto size-12" />
          <h1 className="mt-4 font-display text-title">Watchtower needs JavaScript</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Live location and SOS alerts run entirely on your device. Please enable JavaScript, or
            call your Guardian Circle directly if you are in danger right now.
          </p>
        </div>
      </noscript>
    </body>
  </html>
);

export default RootLayout;
