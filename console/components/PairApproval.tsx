"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClaimView } from "@/app/api/claims/[id]/route";
import { api } from "@/lib/client-api";

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
        <h1 className="text-lg font-semibold tracking-tight">
          Nothing to approve
        </h1>
        <p className="mt-2 text-sm text-muted">{loadError}</p>
        <BackLink />
      </Shell>
    );
  }

  if (!claim) {
    return (
      <Shell>
        <p className="text-sm text-muted">Loading…</p>
      </Shell>
    );
  }

  if (claim.status === "CONSUMED") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight text-online">
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
        <h1 className="text-lg font-semibold tracking-tight">Approved</h1>
        <p className="mt-2 text-sm text-muted">
          Waiting for {claim.hostname} to pick up its credentials…
        </p>
      </Shell>
    );
  }

  if (claim.status === "DENIED") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold tracking-tight">Denied</h1>
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
        <h1 className="text-lg font-semibold tracking-tight">Expired</h1>
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
      <p className="text-xs uppercase tracking-wide text-muted">
        Pairing request
      </p>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">
        {claim.hostname}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {claim.osVersion} · agent {claim.agentVersion}
        {claim.sourceIp ? ` · from ${claim.sourceIp}` : ""}
      </p>

      <div className="mt-6 rounded-lg border border-border bg-background p-4">
        <p className="text-sm">
          Pick the code shown on the PC.
        </p>
        <p className="mt-1 text-xs text-muted">
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
              className="rounded-lg border border-border bg-surface px-4 py-3 font-mono text-xl font-semibold tracking-[0.25em] transition-colors hover:border-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <p className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void decide("deny")}
        className="mt-4 text-sm text-muted underline underline-offset-4 transition-colors hover:text-danger disabled:opacity-50"
      >
        Deny this request
      </button>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-8 flex items-center justify-center gap-2">
        <ShieldMark />
        <span className="font-semibold tracking-tight">DeskWarrant</span>
      </div>
      <div className="rounded-xl border border-border bg-surface p-6">
        {children}
      </div>
    </div>
  );
}

function BackLink({ label = "Back to devices" }: { label?: string }) {
  return (
    <Link
      href="/devices"
      className="mt-6 inline-block text-sm text-accent underline underline-offset-4"
    >
      {label}
    </Link>
  );
}

function ShieldMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
