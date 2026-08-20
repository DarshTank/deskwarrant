"use client";

import { useCallback, useEffect, useState } from "react";
import { api, relativeTime } from "@/lib/client-api";
import { PushToggle } from "./PushToggle";

interface WatchEventItem {
  id: string;
  message: string;
  payload: unknown;
  template: string;
  readAt: string | null;
  createdAt: string;
}

export function EventFeed({ deviceId }: { deviceId: string }) {
  const [events, setEvents] = useState<WatchEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ events: WatchEventItem[] }>(
        `/api/devices/${deviceId}/events`,
      );
      setEvents(data.events);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await load();
      if (active) timer = setTimeout(() => void tick(), 15_000);
    };

    timer = setTimeout(() => void tick(), 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]);

  async function markAllRead() {
    try {
      await api(`/api/devices/${deviceId}/events`, {
        method: "PATCH",
        json: {},
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark as read.");
    }
  }

  const unread = events.filter((e) => !e.readAt).length;

  return (
    <div className="thin-scroll flex-1 overflow-y-auto px-[clamp(12px,3vw,24px)] py-6">
      <div className="max-w-[62ch]">
        <p className="eyebrow">Events</p>
        <h2 className="mt-3 font-serif text-[clamp(24px,3.4vw,32px)] leading-[1.08] tracking-[-0.02em]">
          {unread > 0 ? (
            <>
              {unread} thing{unread === 1 ? "" : "s"} happened{" "}
              <span className="text-soft italic">while you were away.</span>
            </>
          ) : (
            <>
              All caught up.{" "}
              <span className="text-soft italic">Nothing waiting.</span>
            </>
          )}
        </h2>
      </div>

      <div className="mt-6">
        <PushToggle />
      </div>

      {error && (
        <p className="mt-5 rounded-2xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-[14px] text-danger">
          {error}
        </p>
      )}

      {loading && <p className="mt-8 text-[15px] text-faint">Loading…</p>}

      {!loading && events.length === 0 && (
        <p className="mt-8 max-w-[52ch] text-[15px] text-faint">
          No events yet. Arm a watch rule and the first one will land here — and
          on your phone, if push is on.
        </p>
      )}

      {!loading && events.length > 0 && (
        <>
          <div className="mt-9 flex items-center justify-between gap-3 border-b border-line pb-2.5">
            <p className="eyebrow">
              {unread > 0 ? `${unread} unread` : "Everything read"}
            </p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="rounded-full px-3 py-1 text-[13px] text-soft transition-colors hover:bg-ink/[0.05] hover:text-ink"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* A timeline, not cards: these arrive in order and the order is the
              point. Unread is marked by the rail, so a read event does not
              lose its place in the sequence. */}
          <ul className="mt-1">
            {events.map((event) => (
              <li
                key={event.id}
                className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-3.5 border-b border-line2 py-4"
              >
                <span className="mt-[7px] flex justify-center">
                  <span
                    className={`size-1.5 rounded-full ${
                      event.readAt ? "bg-offline" : "bg-signal dw-beat"
                    }`}
                    aria-label={event.readAt ? "Read" : "Unread"}
                  />
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-[15px] leading-[1.5] ${
                      event.readAt ? "text-soft" : "text-ink"
                    }`}
                  >
                    {event.message}
                  </p>
                  <p className="mt-1.5 font-mono text-[11.5px] text-faint">
                    {event.template.toLowerCase()} ·{" "}
                    {relativeTime(event.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
