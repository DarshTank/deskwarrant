"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClaimView } from "@/app/api/claims/[id]/route";
import { api } from "@/lib/client-api";
import { Logo } from "./Logo";

/**
 * Polls until the agent has actually redeemed the claim. Approving only marks
 * the claim; the device row appears when the PC comes back for its token, so
 * "Paired" here means the PC really has credentials, not that a button was
 * pressed.
 */
const POLL_MS = 2_000;

export function PairApproval({ claimId }: { claimId: string }) {
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ claim: ClaimView }>(`/api/claims/${claimId}`);
      setClaim(data.claim);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load this request.",
      );
    }
  }, [claimId]);

  // Nothing changes once a claim is answered and redeemed, so the poll stops.
  // Left running, a forgotten tab would bill a serverless invocation every two
  // seconds forever.
  const settled =
    claim !== null && (claim.status === "CONSUMED" || claim.status === "DENIED");

  useEffect(() => {
    if (settled) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      await refresh();
      if (active) timer = setTimeout(() => void tick(), POLL_MS);
    };

    timer = setTimeout(() => void tick(), 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh, settled]);

  async function decide(path: string, body?: unknown) {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/claims/${claimId}/${path}`, {
        method: "POST",
        json: body ?? {},
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  if (loadError) {
    return (
      <Shell>
        <h1 className="text-[22px] font-extrabold">Nothing to approve</h1>
        <p className="mt-3 text-[15px] leading-[1.6] text-muted">{loadError}</p>
        <BackLink />
      </Shell>
    );
  }

  if (!claim) {
    return (
      <Shell>
        <p className="text-[15px] text-muted">Loading…</p>
      </Shell>
    );
  }

  if (claim.status === "CONSUMED") {
    return (
      <Shell>
        <h1 className="text-[22px] font-extrabold text-online">
          {claim.hostname} is paired
        </h1>
        <p className="mt-2 text-sm text-muted">
          The PC has its credentials and should show as online. You can close
          this page.
        </p>
        <BackLink label="Go to devices" />
      </Shell>
    );
  }

  if (claim.status === "APPROVED") {
    return (
      <Shell>
        <h1 className="text-[22px] font-extrabold">Approved</h1>
        <p className="mt-2 text-sm text-muted">
          Waiting for {claim.hostname} to pick up its credentials…
        </p>
      </Shell>
    );
  }

  if (claim.status === "DENIED") {
    return (
      <Shell>
        <h1 className="text-[22px] font-extrabold">Denied</h1>
        <p className="mt-2 text-sm text-muted">
          This request was refused and cannot be reused. If it was yours, start
          the agent again to get a new one.
        </p>
        <BackLink />
      </Shell>
    );
  }

  if (claim.status === "EXPIRED") {
    return (
      <Shell>
        <h1 className="text-[22px] font-extrabold">Expired</h1>
        <p className="mt-2 text-sm text-muted">
          Pairing requests last 10 minutes. Start the agent on {claim.hostname}{" "}
          again.
        </p>
        <BackLink />
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="kicker">Pairing request</p>
      <h1 className="mt-3 text-[26px] font-extrabold tracking-[-0.02em]">
        {claim.hostname}
      </h1>
      <p className="mt-2 font-mono text-[13px] text-muted">
        {claim.osVersion} · agent {claim.agentVersion}
        {claim.sourceIp ? ` · from ${claim.sourceIp}` : ""}
      </p>

      <div className="mt-7 border-2 border-border bg-background p-5">
        <p className="text-[17px] font-bold">Pick the code shown on the PC.</p>
        <p className="mt-2 text-[14px] leading-[1.55] text-muted">
          It is in the DeskWarrant window on {claim.hostname}. If that window is
          closed, right-click the DeskWarrant icon in the system tray.
        </p>
        <p className="mt-2 text-[14px] leading-[1.55] text-muted">
          If you are not looking at that PC right now, press Deny. A wrong pick
          refuses the request.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {claim.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={busy}
              onClick={() => void decide("approve", { matchCode: choice })}
              className="border-2 border-border bg-surface px-4 py-4 font-mono text-2xl font-extrabold tracking-[0.25em] transition-colors hover:border-accent hover:bg-accent-wash hover:text-accent disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <p className="mt-5 border-2 border-danger/50 bg-danger/10 px-4 py-2.5 text-[15px] text-danger">
          {actionError}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void decide("deny")}
        className="mt-5 text-[13px] uppercase tracking-[0.06em] text-muted transition-colors hover:text-danger disabled:opacity-50"
      >
        Deny this request
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 flex items-center justify-center gap-3">
        <Logo size={26} />
        <span className="text-[17px] font-extrabold tracking-[-0.02em]">
          DeskWarrant
        </span>
      </div>
      <div className="border-2 border-border bg-surface p-7">
        {children}
      </div>
    </div>
  );
}

function BackLink({ label = "Back to devices" }: { label?: string }) {
  return (
    <Link
      href="/devices"
      className="mt-7 inline-block text-[13px] uppercase tracking-[0.06em] text-accent-soft transition-colors hover:text-accent"
    >
      {label}
    </Link>
  );
}
