export const dynamic = "force-static";

/** Minimal PWA manifest so the console can be installed on a phone. */
export function GET() {
  return Response.json({
    name: "DeskWarrant",
    short_name: "DeskWarrant",
    description: "Natural-language PC agent with remote control.",
    start_url: "/devices",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
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
