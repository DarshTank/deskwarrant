import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One family, four weights. The Modernist system draws its hierarchy from
// weight and size rather than from a second typeface.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "DeskWarrant — your PC, on a leash",
  description:
    "Ask, act, watch and control your Windows PC from any browser. Plain-language answers from live system data, a fixed typed action catalog, push alerts when a rule fires, and full remote control over an on-demand encrypted tunnel.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#161514" },
  ],
};

/**
 * Applied before first paint.
 *
 * A saved theme has to land on <html> ahead of the stylesheet resolving, or a
 * dark-mode user gets a light flash on every navigation — which is worse than
 * having no toggle at all.
 *
 * The `js` class is the gate for scroll-reveal: the landing page's reveal
 * animation starts sections at opacity 0, and without this marker a browser
 * that never runs the script would render a page with half its content
 * invisible. Hiding only when JS is known to be present fails visible.
 */
const BOOTSTRAP = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("deskwarrant-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${archivo.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
      </head>
      {/*
        The body scrolls normally so the landing page, sign-in and the pairing
        approval behave like ordinary documents. The console shell pins itself
        to exactly one viewport in its own layout instead, which is what lets
        the chat transcript, live canvas and event feed scroll inside their own
        frames rather than dragging the window scrollbar with them.
      */}
      <body className="min-h-dvh bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
