"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, relativeTime } from "@/lib/client-api";
import { Chat } from "./Chat";
import { EventFeed } from "./EventFeed";
import { LiveView } from "./LiveView";
import { WatchRules } from "./WatchRules";
import { Button, Segmented, StatusDot, inputClass } from "./ui";

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
      setNameDraft(device.name);
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
      {/* Device header. Two rows on a narrow screen, one on a wide one. */}
      <header className="shrink-0 border-b border-line px-[clamp(12px,3vw,32px)] pt-4 pb-3">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex items-start gap-3">
            <Link
              href="/devices"
              className="mt-1.5 shrink-0 text-[13px] text-soft transition-colors hover:text-ink"
            >
              ← <span className="hidden sm:inline">Devices</span>
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5">
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
                    className={`${inputClass} max-w-[280px] font-serif text-[20px]`}
                    aria-label="Device name"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    title="Click to rename"
                    className="truncate font-serif text-[clamp(21px,3.4vw,30px)] leading-tight tracking-[-0.02em] transition-colors hover:text-signal"
                  >
                    {device.name}
                  </button>
                )}
              </div>

              <p className="mt-1 truncate font-mono text-[12px] text-faint">
                {device.hostname} · {device.osVersion} · agent{" "}
                {device.agentVersion} ·{" "}
                {device.online
                  ? "online"
                  : `last seen ${relativeTime(device.lastSeenAt)}`}
              </p>
            </div>

            <Button
              variant="danger"
              size="sm"
              onClick={() => void revoke()}
              className="mt-0.5"
            >
              Revoke
            </Button>
          </div>

          <div className="mt-4">
            <Segmented value={tab} options={TABS} onChange={setTab} />
          </div>
        </div>
      </header>

      {error && (
        <p className="shrink-0 border-b border-danger/25 bg-danger/[0.07] px-[clamp(12px,3vw,32px)] py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        {tab === "chat" && <Chat deviceId={device.id} online={device.online} />}

        {tab === "live" && (
          /*
            Build plan §6: the chat panel stays fully functional beside the
            live canvas, so the user can delegate a task and watch it happen.
            Below xl there is not enough width for both — the canvas wins, and
            chat is one tap away on its own tab.
          */
          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)]">
            <div className="flex min-h-0 flex-col border-line xl:border-r">
              <LiveView deviceId={device.id} online={device.online} />
            </div>
            <div className="hidden min-h-0 flex-col xl:flex">
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
