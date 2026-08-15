"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, relativeTime } from "@/lib/client-api";
import { Chat } from "./Chat";
import { EventFeed } from "./EventFeed";
import { LiveView } from "./LiveView";
import { StatusDot } from "./StatusDot";
import { WatchRules } from "./WatchRules";

interface DeviceDetail {
  id: string;
  name: string;
  hostname: string;
  osVersion: string;
  agentVersion: string;
  online: boolean;
  lastSeenAt: string | null;
  pairedAt: string;
}

type Tab = "chat" | "live" | "watch" | "events";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "live", label: "Live" },
  { id: "watch", label: "Watch" },
  { id: "events", label: "Events" },
];

export function DeviceWorkspace({ initial }: { initial: DeviceDetail }) {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceDetail>(initial);
  const [tab, setTab] = useState<Tab>("chat");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initial.name);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ device: DeviceDetail }>(
        `/api/devices/${initial.id}`,
      );
      setDevice(data.device);
    } catch {
      /* transient; the next tick retries */
    }
  }, [initial.id]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function rename() {
    const name = nameDraft.trim();
    if (!name || name === device.name) {
      setRenaming(false);
      return;
    }
    try {
      await api(`/api/devices/${device.id}`, {
        method: "PATCH",
        json: { name },
      });
      setDevice((d) => ({ ...d, name }));
      setRenaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed.");
    }
  }

  async function revoke() {
    if (
      !window.confirm(
        `Revoke ${device.name}? The agent will be signed out and must be paired again.`,
      )
    ) {
      return;
    }
    try {
      await api(`/api/devices/${device.id}`, { method: "DELETE" });
      router.push("/devices");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/devices" className="text-xs text-muted hover:text-foreground">
            ← Devices
          </Link>

          <div className="flex min-w-0 items-center gap-2">
            <StatusDot online={device.online} />
            {renaming ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void rename()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void rename();
                  if (e.key === "Escape") {
                    setNameDraft(device.name);
                    setRenaming(false);
                  }
                }}
                className="rounded-md border border-border bg-background px-2 py-0.5 text-sm outline-none focus:border-accent"
              />
            ) : (
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="truncate text-sm font-semibold"
                title="Click to rename"
              >
                {device.name}
              </button>
            )}
          </div>

          <span className="hidden truncate text-xs text-muted sm:inline">
            {device.osVersion} ·{" "}
            {device.online
              ? "online"
              : `last seen ${relativeTime(device.lastSeenAt)}`}
          </span>

          <button
            type="button"
            onClick={() => void revoke()}
            className="ml-auto rounded-md border border-border px-2 py-1 text-[11px] text-danger transition-colors hover:bg-danger/10"
          >
            Revoke
          </button>
        </div>

        <div className="mx-auto flex max-w-6xl gap-1 px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === t.id
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="shrink-0 border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {/* Body */}
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        {tab === "chat" && <Chat deviceId={device.id} online={device.online} />}

        {tab === "live" && (
          // Build plan §6: the chat panel stays fully functional beside the
          // live canvas, so the user can delegate a task and watch it happen.
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="flex min-h-0 flex-col border-border lg:border-r">
              <LiveView deviceId={device.id} online={device.online} />
            </div>
            <div className="hidden min-h-0 flex-col lg:flex">
              <Chat deviceId={device.id} online={device.online} compact />
            </div>
          </div>
        )}

        {tab === "watch" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <WatchRules deviceId={device.id} />
          </div>
        )}

        {tab === "events" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <EventFeed deviceId={device.id} />
          </div>
        )}
      </div>
    </div>
  );
}
