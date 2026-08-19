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

  return (
    <div className="border-2 border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[16px] font-bold">Push notifications</p>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted">
            {state === "unsupported" &&
              "This browser does not support web push."}
            {state === "unconfigured" &&
              "VAPID keys are not configured on the server."}
            {state === "denied" &&
              "Blocked in browser settings. Re-allow notifications for this site."}
            {state === "on" && "Watch events will reach you with the tab closed."}
            {state === "off" && "Turn on to get alerts when a rule fires."}
            {state === "busy" && "Checking…"}
          </p>
        </div>
        {(state === "on" || state === "off") && (
          <button
            type="button"
            onClick={() => void (state === "on" ? disable() : enable())}
            className="shrink-0 border-2 border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors hover:border-accent hover:text-accent"
          >
            {state === "on" ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
    </div>
  );
}
