/**
 * A square, not a dot — the system has no round corners anywhere else, and a
 * lone circle in the device header reads as a stray element rather than a
 * status light.
 */
export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className="relative inline-flex h-2.5 w-2.5 shrink-0"
      title={online ? "Online" : "Offline"}
      aria-label={online ? "Online" : "Offline"}
    >
      {online && (
        <span className="absolute inline-flex h-full w-full animate-ping bg-online opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 ${
          online ? "bg-online" : "bg-offline"
        }`}
      />
    </span>
  );
}
