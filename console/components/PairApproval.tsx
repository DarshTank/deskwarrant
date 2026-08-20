"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClaimView } from "@/app/api/claims/[id]/route";
import { api } from "@/lib/client-api";
import { Logo } from "./Logo";
import { Button, ButtonLink, Eyebrow, Notice } from "./ui";

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
      <Outcome
        eyebrow="Pairing"
        title="Nothing to approve"
        body={loadError}
        back
      />
    );
  }

  if (!claim) {
    return (
      <Shell>
        <div className="animate-pulse space-y-4" aria-hidden="true">
          <div className="h-3 w-24 rounded-full bg-ink/10" />
          <div className="h-10 w-2/3 rounded-full bg-ink/10" />
          <div className="h-40 rounded-2xl bg-ink/[0.06]" />
        </div>
        <p className="sr-only">Loading the pairing request…</p>
      </Shell>
    );
  }

  if (claim.status === "CONSUMED") {
    return (
      <Outcome
        tone="signal"
        eyebrow="Paired"
        title={`${claim.hostname} is yours.`}
        body="The machine has its credentials and should already be showing as online. You can close this page."
        action={
          <ButtonLink href="/devices" variant="primary" size="lg">
            Go to devices
          </ButtonLink>
        }
      />
    );
  }

  if (claim.status === "APPROVED") {
    return (
      <Outcome
        tone="signal"
        eyebrow="Approved"
        title="Waiting for the machine."
        body={`${claim.hostname} is collecting its credentials. This page updates itself the moment it does.`}
        pending
      />
    );
  }

  if (claim.status === "DENIED") {
    return (
      <Outcome
        eyebrow="Denied"
        title="This request was refused."
        body="It cannot be reused. If it was yours, start the agent again on that PC to raise a new one."
        back
      />
    );
  }

  if (claim.status === "EXPIRED") {
    return (
      <Outcome
        eyebrow="Expired"
        title="That request timed out."
        body={`Pairing requests last ten minutes. Start the agent on ${claim.hostname} again.`}
        back
      />
    );
  }

  return (
    <Shell>
      <Eyebrow>Pairing request</Eyebrow>
      <h1 className="mt-4 font-serif text-[clamp(32px,6vw,52px)] leading-[0.98] tracking-[-0.03em] break-words">
        {claim.hostname}
      </h1>
      <p className="mt-4 text-[16px] text-soft">
        wants to join your account.
      </p>

      <dl className="mt-8 grid gap-y-3 font-mono text-[13px] sm:grid-cols-[88px_minmax(0,1fr)]">
        <dt className="text-faint">os</dt>
        <dd className="mb-1 text-soft sm:mb-0">{claim.osVersion}</dd>
        <dt className="text-faint">agent</dt>
        <dd className="mb-1 text-soft sm:mb-0">{claim.agentVersion}</dd>
        {claim.sourceIp && (
          <>
            <dt className="text-faint">from</dt>
            <dd className="text-soft">{claim.sourceIp}</dd>
          </>
        )}
      </dl>

      <div className="mt-9 rounded-2xl border border-line bg-raised p-5 sm:p-7">
        <h2 className="font-serif text-[24px] leading-tight tracking-[-0.02em]">
          Pick the code shown on the PC.
        </h2>
        <p className="mt-3 text-[15px] text-soft">
          It is in the DeskWarrant window on {claim.hostname}. If that window is
          closed, right-click the DeskWarrant icon in the system tray.
        </p>
        <p className="mt-2 text-[15px] text-soft">
          If you are not looking at that machine right now, press Deny. A wrong
          pick refuses the request — there is no second attempt.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {claim.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              disabled={busy}
              onClick={() => void decide("approve", { matchCode: choice })}
              className="rounded-2xl border border-line bg-paper py-5 font-mono text-[clamp(20px,6vw,28px)] font-medium tracking-[0.2em] transition-[border-color,background-color,transform] duration-200 hover:border-signal hover:bg-signal-soft active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
            >
              {choice}
            </button>
          ))}
        </div>
      </div>

      {actionError && <Notice className="mt-6">{actionError}</Notice>}

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => void decide("deny")}
        >
          Deny this request
        </Button>
        <span className="text-[13.5px] text-faint">
          Denying is instant and permanent for this request.
        </span>
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[620px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-[36vmax] left-1/2 h-[64vmax] w-[64vmax] -translate-x-1/2 rounded-full blur-[18px]"
        style={{
          background:
            "radial-gradient(circle, var(--wash) 0%, transparent 62%)",
        }}
      />
      <div className="relative">
        <Link
          href="/"
          className="mb-10 inline-flex items-center gap-3 text-ink"
        >
          <Logo size={38} />
          <span className="font-serif text-[23px] tracking-[-0.01em] leading-none">
            DeskWarrant
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}

/** Every terminal state of a claim, in one shape. */
function Outcome({
  eyebrow,
  title,
  body,
  tone = "neutral",
  action,
  back = false,
  pending = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  tone?: "neutral" | "signal";
  action?: React.ReactNode;
  back?: boolean;
  pending?: boolean;
}) {
  return (
    <Shell>
      <p className={`eyebrow ${tone === "signal" ? "text-signal" : ""}`}>
        {eyebrow}
      </p>
      <h1 className="mt-4 font-serif text-[clamp(30px,5.5vw,48px)] leading-[1.0] tracking-[-0.03em]">
        {title}
      </h1>
      <p className="mt-5 max-w-[46ch] text-[16px] text-soft">{body}</p>

      {pending && (
        <p className="mt-7 inline-flex items-center gap-2.5 rounded-full border border-line px-4 py-2 font-mono text-[13px] text-soft">
          <span className="dw-beat size-1.5 rounded-full bg-signal" />
          waiting
        </p>
      )}

      {(action || back) && (
        <div className="mt-9 flex flex-wrap gap-3">
          {action}
          {back && (
            <ButtonLink href="/devices" variant="secondary" size="lg">
              Back to devices
            </ButtonLink>
          )}
        </div>
      )}
    </Shell>
  );
}
