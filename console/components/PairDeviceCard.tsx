"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { Button, ButtonLink, Eyebrow, Notice } from "./ui";

interface Minted {
  code: string;
  expiresAt: string;
}

/**
 * Pairing is agent-initiated: you run the agent on the PC and it opens this
 * console to an approval screen. There is nothing to click here first, which is
 * why this card is instructions rather than a button.
 *
 * The typed code below it is the fallback for a PC with no browser and no phone
 * in reach, reached with `--code`. It is folded away because reaching for it
 * when the normal path would have worked is strictly more work.
 *
 * `empty` is the same card doing the empty state's job. Splitting them into two
 * components meant the fallback flow existed twice and drifted.
 */
export function PairDeviceCard({
  onPaired,
  empty = false,
}: {
  onPaired: () => void;
  empty?: boolean;
}) {
  const [minted, setMinted] = useState<Minted | null>(null);
  const [showFallback, setShowFallback] = useState(false);
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
    <div
      className={`rounded-2xl border bg-raised p-6 sm:p-8 ${
        empty ? "border-dashed border-line" : "border-line"
      }`}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <Eyebrow>{empty ? "Nothing here yet" : "Pair another machine"}</Eyebrow>
          <h2 className="mt-3 font-serif text-[clamp(24px,3.2vw,34px)] leading-[1.08] tracking-[-0.022em]">
            {empty ? "Add your first PC." : "Nothing to type."}
          </h2>
          <p className="mt-4 max-w-[46ch] text-[15.5px] text-soft">
            Install DeskWarrant on the Windows machine. It opens a browser back
            here and asks you to approve it — pick the four-character code it is
            showing, and the PC is paired.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <ButtonLink href="/download" variant="primary" size="lg">
              Add a PC
            </ButtonLink>
            {!showFallback && (
              <button
                type="button"
                onClick={() => setShowFallback(true)}
                className="text-[14px] text-soft transition-colors hover:text-ink"
              >
                Pair with a typed code instead →
              </button>
            )}
          </div>
        </div>

        <ol className="grid content-start gap-0 text-[15px]">
          {[
            "Run the installer — no administrator prompt.",
            "The agent opens this console and shows a code.",
            "Pick the matching code. That is the whole setup.",
          ].map((line, i) => (
            <li
              key={line}
              className="grid grid-cols-[38px_minmax(0,1fr)] items-baseline gap-3 border-t border-line py-4 last:border-b"
            >
              <span className="font-serif text-[26px] leading-none text-numeral">
                0{i + 1}
              </span>
              <span className="text-soft">{line}</span>
            </li>
          ))}
        </ol>
      </div>

      {showFallback && (
        <div className="mt-8 border-t border-line pt-6">
          <Eyebrow>Fallback · typed code</Eyebrow>
          <p className="mt-3 max-w-[62ch] text-[15px] text-soft">
            For a machine with no browser and no phone in reach. Run the agent
            with{" "}
            <code className="rounded-full bg-ink/[0.06] px-2 py-0.5 font-mono text-[13px] text-ink">
              --pair --code
            </code>{" "}
            and enter this. Codes last ten minutes and work once.
          </p>

          {minted && !expired && (
            <div className="mt-5 inline-flex flex-col rounded-2xl border border-signal/25 bg-signal-soft px-6 py-5">
              <span className="eyebrow text-signal">Pairing code</span>
              <span className="mt-2 font-mono text-[clamp(28px,7vw,40px)] leading-none font-medium tracking-[0.22em] text-ink">
                {minted.code}
              </span>
              <span className="mt-3 font-mono text-[12px] text-soft">
                expires in {Math.floor(secondsLeft / 60)}m
                {String(secondsLeft % 60).padStart(2, "0")}s
              </span>
            </div>
          )}

          {expired && (
            <Notice tone="warn" className="mt-5">
              That code expired. Generate a new one.
            </Notice>
          )}

          {error && <Notice className="mt-5">{error}</Notice>}

          <div className="mt-5">
            <Button onClick={() => void mint()} disabled={busy}>
              {busy
                ? "Generating…"
                : minted && !expired
                  ? "Generate a new code"
                  : "Generate pairing code"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
