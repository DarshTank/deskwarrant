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
    <div className="thin-scroll flex-1 overflow-y-auto px-4 py-4">
      <PushToggle />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          {unread > 0 ? `${unread} unread` : "All caught up"}
        </p>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading && <p className="mt-4 text-sm text-muted">Loading…</p>}

      {!loading && events.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          No events yet. Add a watch rule and one will appear here when it fires.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li
            key={event.id}
            className={`rounded-lg border p-3 ${
              event.readAt
                ? "border-border bg-surface"
                : "border-accent/40 bg-accent/5"
            }`}
          >
            <p className="text-sm">{event.message}</p>
            <p className="mt-1 text-[11px] text-muted">
              {event.template} · {relativeTime(event.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
