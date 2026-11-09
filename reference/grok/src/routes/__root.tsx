import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { CelestialWorld } from "@/components/world/celestial-world";
import { SiteNav } from "@/components/nav/site-nav";
import { AccountSheet } from "@/components/account/account-sheet";
import appCss from "../styles.css?url";

const APP_NAME = "Photobooth AI";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Step into another version of you. A premium digital photography studio.",
      },
      { name: "theme-color", content: "#F7F7F5" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap",
      },
    ],
  }),
  notFoundComponent: NotFound,
  component: RootShell,
});

function RootShell() {
  return (
    <html lang="en" className="antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="bg-paper font-sans text-ink">
        <PreviewHostBridge />
        <AuthProvider>
          <CelestialWorld />
          <div className="grain" aria-hidden="true" />
          <SiteNav />
          <Outlet />
          <AccountSheet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="hero-kicker">Studio</p>
      <h1 className="mt-4 font-display text-5xl">We couldn't find that room.</h1>
      <Link
        to="/"
        className="mt-8 text-sm tracking-wide underline underline-offset-4"
      >
        Return home
      </Link>
    </main>
  );
}
