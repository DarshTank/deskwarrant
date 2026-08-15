"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface Minted {
  code: string;
  expiresAt: string;
}

export function PairDeviceCard({ onPaired }: { onPaired: () => void }) {
  const [minted, setMinted] = useState<Minted | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!minted) return;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.round((new Date(minted.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      // The agent pairs out-of-band, so refresh the device list while a code
      // is live to catch the moment it lands.
      if (remaining > 0) onPaired();
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => clearInterval(timer);
  }, [minted, onPaired]);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<Minted>("/api/devices/pairing-code", {
        method: "POST",
      });
      setMinted(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a code.");
    } finally {
      setBusy(false);
    }
  }

  const expired = minted !== null && secondsLeft <= 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="text-sm font-medium">Pair a new PC</h2>
      <p className="mt-1 text-sm text-muted">
        Start the agent on the Windows PC. When it asks for a pairing code,
        generate one here and type it in. Codes last 10 minutes and work once.
      </p>

      {minted && !expired && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
          <p className="text-xs uppercase tracking-wide text-muted">
            Pairing code
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.3em]">
            {minted.code}
          </p>
          <p className="mt-2 text-xs text-muted">
            Expires in {Math.floor(secondsLeft / 60)}m{" "}
            {String(secondsLeft % 60).padStart(2, "0")}s
          </p>
        </div>
      )}

      {expired && (
        <p className="mt-4 text-sm text-warn">
          That code expired. Generate a new one.
        </p>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={() => void mint()}
        disabled={busy}
        className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy
          ? "Generating…"
          : minted && !expired
            ? "Generate a new code"
            : "Generate pairing code"}
      </button>
    </div>
  );
}
