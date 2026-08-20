import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Instrument Serif ships one weight; the italic is a separate style and the
// design leans on it for the second half of every display line.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "DeskWarrant — your PC, on a leash",
  description:
    "Ask your Windows PC a question in plain language, tell it what to do, have it watch for what you are waiting on, and take the mouse yourself when you want to.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The console shell pins itself to the viewport, so an on-screen keyboard
  // must resize it rather than scroll it out from under the composer.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e11" },
  ],
};

/**
 * Applied before first paint.
 *
 * A saved theme has to land on <html> ahead of the stylesheet resolving, or a
 * dark-mode user gets a light flash on every navigation — which is worse than
 * having no toggle at all.
 *
 * The `js` class is the gate for scroll reveal: revealed sections start at
 * opacity 0, and without this marker a browser that never ran the script would
 * paint a page with half its content invisible. Hiding only when JS is known
 * to be present fails visible.
 */
const BOOTSTRAP = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("deskwarrant-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /*
      suppressHydrationWarning is required, not a papered-over bug: BOOTSTRAP
      deliberately mutates this element's class and data-theme before React
      hydrates, so the server HTML and the live DOM genuinely differ here. The
      alternative — rendering the theme on the client after mount — is the
      light flash the script exists to prevent.

      It applies to this element's own attributes only. Everything inside it is
      still hydration-checked normally.
    */
    <html
      lang="en"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
      </head>
      {/*
        The body scrolls normally so the landing page, sign-in and the pairing
        approval behave like ordinary documents. The console shell pins itself
        to one viewport in its own layout instead, which is what lets the chat
        transcript, live canvas and event feed scroll inside their own frames
        rather than dragging the window scrollbar with them.
      */}
      <body className="min-h-dvh bg-paper text-ink">{children}</body>
    </html>
  );
}
