export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className="relative inline-flex h-2 w-2 shrink-0"
      title={online ? "Online" : "Offline"}
      aria-label={online ? "Online" : "Offline"}
    >
      {online && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${
          online ? "bg-online" : "bg-offline"
        }`}
      />
    </span>
  );
}
