"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { DeviceSummary } from "@/app/api/devices/route";
import { api, relativeTime } from "@/lib/client-api";
import { PairDeviceCard } from "./PairDeviceCard";
import { ButtonLink, Notice, PageHeading, StatusDot } from "./ui";

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

  const online = devices?.filter((d) => d.online).length ?? 0;
  const total = devices?.length ?? 0;

  return (
    // The shell no longer scrolls, so this page owns its own scrolling.
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-[clamp(16px,4vw,40px)] py-8 sm:py-10">
        <PageHeading
          eyebrow="Your machines"
          title="Devices"
          meta={
            devices === null
              ? "loading…"
              : total === 0
                ? "none paired yet"
                : `${online} of ${total} online`
          }
          actions={
            total > 0 ? (
              <ButtonLink href="/download" variant="primary">
                Add a PC
              </ButtonLink>
            ) : undefined
          }
        />

        {error && <Notice className="mt-8">{error}</Notice>}

        {devices === null && (
          <ul className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                aria-hidden="true"
                className="h-[168px] animate-pulse rounded-2xl border border-line bg-ink/[0.03]"
              />
            ))}
          </ul>
        )}

        {devices !== null && total === 0 && (
          <div className="mt-9">
            <PairDeviceCard onPaired={refresh} empty />
          </div>
        )}

        {devices !== null && total > 0 && (
          <>
            <ul className="mt-9 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {devices.map((device) => (
                <li key={device.id}>
                  <DeviceCard device={device} />
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <PairDeviceCard onPaired={refresh} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The card is the whole hit target, which is why the name is a plain span and
 * not a nested link. The arrow is the only affordance that moves — a card that
 * lifts on hover competes with the status dot for attention.
 */
function DeviceCard({ device }: { device: DeviceSummary }) {
  return (
    <Link
      href={`/devices/${device.id}`}
      className="group flex h-full flex-col rounded-2xl border border-line bg-raised p-5 transition-colors hover:border-ink/25"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <StatusDot online={device.online} />
          <span className="truncate font-serif text-[22px] leading-tight tracking-[-0.015em]">
            {device.name}
          </span>
        </span>
        {device.unreadEvents > 0 && (
          <span className="shrink-0 rounded-full bg-signal-soft px-2.5 py-0.5 text-[12px] font-medium text-signal">
            {device.unreadEvents} new
          </span>
        )}
      </div>

      <dl className="mt-5 space-y-1.5 font-mono text-[12px] text-faint">
        <div className="flex justify-between gap-4">
          <dt className="shrink-0">host</dt>
          <dd className="truncate text-soft">{device.hostname}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="shrink-0">os</dt>
          <dd className="truncate text-soft">{device.osVersion}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="shrink-0">agent</dt>
          <dd className="truncate text-soft">{device.agentVersion}</dd>
        </div>
      </dl>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line2 pt-4 text-[13px]">
        <span className={device.online ? "text-signal" : "text-faint"}>
          {device.online
            ? "Answering now"
            : `Last seen ${relativeTime(device.lastSeenAt)}`}
        </span>
        <span
          aria-hidden="true"
          className="text-soft transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] group-hover:translate-x-1"
        >
          →
        </span>
      </div>
    </Link>
  );
}
