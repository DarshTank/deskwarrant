"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DeviceSummary } from "@/app/api/devices/route";
import { api, relativeTime } from "@/lib/client-api";
import { PairDeviceCard } from "./PairDeviceCard";
import { StatusDot } from "./StatusDot";

const REFRESH_MS = 5_000;

export function DeviceList() {
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ devices: DeviceSummary[] }>("/api/devices");
      setDevices(data.devices);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load devices.");
    }
  }, []);

  // 5s client poll drives the live online/offline badge (build plan §10.1).
  // Self-rescheduling rather than setInterval: a slow response delays the next
  // poll instead of stacking a second one on top of it.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refresh();
      if (active) timer = setTimeout(() => void tick(), REFRESH_MS);
    };

    timer = setTimeout(() => void tick(), 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  return (
    // The shell no longer scrolls, so this page owns its own scrolling.
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
        {devices && devices.length > 0 && (
          <span className="text-xs text-muted">
            {devices.filter((d) => d.online).length} of {devices.length} online
          </span>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {devices === null && (
        <p className="text-sm text-muted">Loading…</p>
      )}

      {devices && devices.length === 0 && (
        <div className="mb-8 rounded-xl border border-border bg-surface p-6">
          <h2 className="text-sm font-medium">No devices paired yet</h2>
          <p className="mt-1 text-sm text-muted">
            Run the agent on your Windows PC, then generate a code below and
            enter it when the agent asks.
          </p>
        </div>
      )}

      {devices && devices.length > 0 && (
        <ul className="mb-10 grid gap-3 sm:grid-cols-2">
          {devices.map((device) => (
            <li key={device.id}>
              <Link
                href={`/devices/${device.id}`}
                className="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot online={device.online} />
                      <span className="truncate font-medium">{device.name}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {device.osVersion} · agent {device.agentVersion}
                    </p>
                  </div>
                  {device.unreadEvents > 0 && (
                    <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-fg">
                      {device.unreadEvents}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs text-muted">
                  {device.online
                    ? "Online"
                    : `Last seen ${relativeTime(device.lastSeenAt)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

        <PairDeviceCard onPaired={refresh} />
      </div>
    </div>
  );
}
