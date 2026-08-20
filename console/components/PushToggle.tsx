"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

type State = "unsupported" | "unconfigured" | "off" | "on" | "denied" | "busy";

/** base64url → Uint8Array, the format the Push API wants for the VAPID key. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

const COPY: Record<State, string> = {
  unsupported: "This browser does not support web push.",
  unconfigured: "VAPID keys are not configured on the server.",
  denied: "Blocked in browser settings. Re-allow notifications for this site.",
  on: "Watch events reach you with the tab closed.",
  off: "Turn on to get alerted the moment a rule fires.",
  busy: "Checking…",
};

export function PushToggle() {
  const [state, setState] = useState<State>("busy");
  const [error, setError] = useState<string | null>(null);

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    if (typeof window === "undefined") return;

    let active = true;

    // Capability detection is synchronous, but running it inside the effect
    // body would set state during the effect and cascade a render. Deferring
    // by a tick keeps mount to a single pass.
    const timer = setTimeout(() => {
      void (async () => {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          if (active) setState("unsupported");
          return;
        }
        if (!vapidKey) {
          if (active) setState("unconfigured");
          return;
        }
        if (Notification.permission === "denied") {
          if (active) setState("denied");
          return;
        }
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          const subscription = await registration?.pushManager.getSubscription();
          if (active) setState(subscription ? "on" : "off");
        } catch {
          if (active) setState("off");
        }
      })();
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [vapidKey]);

  async function enable() {
    setState("busy");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      const raw = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };

      await api("/api/push/subscribe", {
        method: "POST",
        json: {
          endpoint: raw.endpoint,
          keys: { p256dh: raw.keys?.p256dh, auth: raw.keys?.auth },
        },
      });

      setState("on");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not enable notifications.",
      );
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api("/api/push/subscribe", {
          method: "DELETE",
          json: { endpoint: subscription.endpoint },
        }).catch(() => {});
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  const actionable = state === "on" || state === "off";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-raised px-5 py-4">
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          state === "on" ? "bg-signal dw-beat" : "bg-offline"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium">Push notifications</p>
        <p className="mt-0.5 text-[13.5px] text-soft">{COPY[state]}</p>
      </div>
      {actionable && (
        <button
          type="button"
          onClick={() => void (state === "on" ? disable() : enable())}
          className={`shrink-0 rounded-full px-5 py-2 text-[13px] font-medium transition-colors ${
            state === "on"
              ? "border border-line text-soft hover:border-ink/35 hover:text-ink"
              : "bg-ink text-paper hover:opacity-85"
          }`}
        >
          {state === "on" ? "Turn off" : "Turn on"}
        </button>
      )}
      {error && (
        <p className="w-full text-[13px] text-danger">{error}</p>
      )}
    </div>
  );
}
