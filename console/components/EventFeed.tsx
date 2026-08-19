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
    <div className="thin-scroll flex-1 overflow-y-auto px-4 py-5">
      <PushToggle />

      <div className="mt-6 flex items-center justify-between border-b-2 border-border pb-3">
        <p className="kicker">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="text-[12px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-accent"
          >
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <p className="mt-4 border-2 border-danger/50 bg-danger/10 px-3 py-2 text-[14px] text-danger">
          {error}
        </p>
      )}

      {loading && <p className="mt-5 text-[15px] text-muted">Loading…</p>}

      {!loading && events.length === 0 && (
        <p className="mt-6 text-[15px] leading-[1.6] text-muted">
          No events yet. Add a watch rule and one will appear here when it fires.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {events.map((event) => (
          <li
            key={event.id}
            className={`border-l-4 border-y border-r border-y-hairline border-r-hairline p-3.5 ${
              event.readAt
                ? "border-l-hairline bg-surface"
                : "border-l-accent bg-accent-wash"
            }`}
          >
            <p className="text-[15px] leading-[1.55]">{event.message}</p>
            <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.05em] text-muted">
              {event.template} · {relativeTime(event.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
