export const dynamic = "force-static";

/** Minimal PWA manifest so the console can be installed on a phone. */
export function GET() {
  return Response.json({
    name: "DeskWarrant",
    short_name: "DeskWarrant",
    description: "Natural-language PC agent with remote control.",
    start_url: "/devices",
    display: "standalone",
    // Matches the theme's dark ground, which is what an installed PWA splash
    // should paint. A manifest takes one colour, so it picks the dark one.
    background_color: "#161514",
    theme_color: "#161514",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  });
}
