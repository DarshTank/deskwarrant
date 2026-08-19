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
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-border pb-5">
          <div>
            <p className="kicker">Your machines</p>
            <h1
              className="mt-3 font-extrabold"
              style={{
                fontSize: "clamp(28px, 4vw, 40px)",
                lineHeight: 1.06,
                letterSpacing: "-0.03em",
                marginLeft: "-0.04em",
              }}
            >
              Devices
            </h1>
          </div>
          {devices && devices.length > 0 && (
            <span className="text-[13px] uppercase tracking-[0.06em] text-muted">
              {devices.filter((d) => d.online).length} of {devices.length} online
            </span>
          )}
        </div>

        {error && (
          <p className="mt-6 border-2 border-danger/50 bg-danger/10 px-4 py-2.5 text-[15px] text-danger">
            {error}
          </p>
        )}

        {devices === null && (
          <p className="mt-6 text-[15px] text-muted">Loading…</p>
        )}

        {devices && devices.length === 0 && (
          <div className="mt-8 border-2 border-border bg-surface p-6">
            <p className="kicker kicker-muted">Nothing here yet</p>
            <h2 className="mt-3 text-[20px] font-bold">No devices paired</h2>
            <p className="mt-2 text-[15px] leading-[1.6] text-muted">
              Run the agent on your Windows PC. It will open this console and
              ask you to approve it.
            </p>
          </div>
        )}

        {devices && devices.length > 0 && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {devices.map((device) => (
              <li key={device.id}>
                <Link
                  href={`/devices/${device.id}`}
                  className="block border-2 border-border bg-surface p-5 transition-colors hover:border-accent"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <StatusDot online={device.online} />
                        <span className="truncate text-[17px] font-bold">
                          {device.name}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate font-mono text-[12px] text-muted">
                        {device.osVersion} · agent {device.agentVersion}
                      </p>
                    </div>
                    {device.unreadEvents > 0 && (
                      <span className="shrink-0 bg-accent px-2 py-0.5 text-[12px] font-extrabold text-accent-fg">
                        {device.unreadEvents}
                      </span>
                    )}
                  </div>
                  <p className="mt-4 border-t border-hairline pt-3 text-[12px] uppercase tracking-[0.06em] text-muted">
                    {device.online
                      ? "Online"
                      : `Last seen ${relativeTime(device.lastSeenAt)}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10">
          <PairDeviceCard onPaired={refresh} />
        </div>
      </div>
    </div>
  );
}
