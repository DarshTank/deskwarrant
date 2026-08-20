"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const SHELL = "mx-auto w-full max-w-[1180px] px-[clamp(22px,5vw,56px)]";
const SECTION = "pt-[clamp(88px,16vh,180px)]";

type Capability = "ask" | "act" | "watch" | "control";

export function Landing({ signedIn }: { signedIn: boolean }) {
  const ctaLabel = signedIn ? "Open the console" : "Get started free";
  const ctaHref = signedIn ? "/devices" : "/signin";

  const [tab, setTab] = useState<Capability>("ask");
  const typed = useTypewriter();
  const washRef = usePointerWash();
  const progressRef = useScrollProgress();
  useReveal();

  return (
    <div className="relative min-h-dvh overflow-x-hidden text-[17px] leading-[1.6]">
      {/* A soft radial that follows the pointer. Fixed, behind everything, and
          inert — on touch it simply stays where it was parked. */}
      <div
        ref={washRef}
        aria-hidden="true"
        className="pointer-events-none fixed top-0 left-0 z-0 h-[78vmax] w-[78vmax] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-85 blur-[18px] transition-transform duration-[1400ms] ease-[cubic-bezier(.15,.8,.25,1)] will-change-transform"
        style={{
          margin: "-39vmax 0 0 -39vmax",
          background:
            "radial-gradient(circle, var(--wash) 0%, transparent 62%)",
          transform: "none",
        }}
      />

      <div className="relative z-10">
        {/* ---------------------------------------------------------------- */}
        <header className="sticky top-0 z-30 border-b border-line2 bg-paper/[0.78] backdrop-blur-xl backdrop-saturate-[1.8]">
          <div
            ref={progressRef}
            aria-hidden="true"
            className="absolute bottom-[-1px] left-0 h-[1.5px] w-full origin-left scale-x-0 bg-signal will-change-transform"
          />
          <div className={`${SHELL} flex items-center gap-6 py-4 sm:gap-8`}>
            <a href="#top" className="inline-flex shrink-0 items-center gap-3">
              <Logo size={38} />
              {/* Below 400px the mark carries the brand alone — the wordmark,
                  the toggle and the call to action together overflow. */}
              <span className="hidden font-serif text-[23px] tracking-[-0.01em] leading-none xs:inline">
                DeskWarrant
              </span>
            </a>

            <nav className="ml-auto flex items-center gap-5 text-[14.5px] text-soft lg:gap-[26px]">
              <a className="hidden whitespace-nowrap hover:text-ink lg:inline" href="#capabilities">
                Capabilities
              </a>
              <a className="hidden whitespace-nowrap hover:text-ink lg:inline" href="#flow">
                How it works
              </a>
              <a className="hidden whitespace-nowrap hover:text-ink lg:inline" href="#trust">
                Privacy
              </a>
              <Link className="hidden whitespace-nowrap hover:text-ink lg:inline" href="/actions">
                Actions
              </Link>
              <Link className="hidden whitespace-nowrap hover:text-ink lg:inline" href="/download">
                Download
              </Link>
              <ThemeToggle className="p-1.5" />
              <Link
                href={ctaHref}
                className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium whitespace-nowrap text-paper transition-opacity hover:opacity-85 sm:px-[17px] sm:py-[9px]"
              >
                {ctaLabel}
              </Link>
            </nav>
          </div>
        </header>

        {/* ---------------------------------------------------------------- */}
        <section
          id="top"
          className="mx-auto w-full max-w-[940px] px-[clamp(22px,5vw,56px)] pt-[clamp(64px,13vh,150px)] text-center"
        >
          {/* The line break is deliberate, so the first line has to fit on one
              line at every width — hence a floor low enough for a 360px phone
              rather than a comfortable-looking one that overflows there. */}
          <h1
            className="font-serif text-[clamp(30px,9vw,128px)] leading-[0.94] tracking-[-0.035em]"
            style={{ animation: "dw-in 1s .1s cubic-bezier(.2,.7,.2,1) both" }}
          >
            Your PC, on a leash.
            <br />
            <span className="text-soft italic">From anywhere.</span>
          </h1>

          <p
            className="mx-auto mt-[34px] max-w-[47ch] text-[clamp(17px,1.9vw,21px)] leading-[1.55] text-soft"
            style={{ animation: "dw-in .9s .24s cubic-bezier(.2,.7,.2,1) both" }}
          >
            Ask your computer a question in plain language. Tell it what to do.
            Have it watch for the thing you are waiting on — and take the mouse
            yourself when you want to.
          </p>

          <div
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
            style={{ animation: "dw-in .9s .36s cubic-bezier(.2,.7,.2,1) both" }}
          >
            <Link
              href={ctaHref}
              className="rounded-full bg-ink px-[26px] py-3.5 text-[16px] font-medium text-paper transition-[transform,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:opacity-90"
            >
              {ctaLabel}
            </Link>
            <a
              href="#flow"
              className="px-[22px] py-3.5 text-[16px] text-soft transition-colors hover:text-ink"
            >
              See how it works →
            </a>
          </div>

          {/* A turn, verbatim — the last line types itself. */}
          <div
            className="mx-auto mt-[clamp(48px,9vh,96px)] max-w-[620px] text-left font-mono text-[clamp(12.5px,3.2vw,14.5px)] leading-[2.05]"
            style={{ animation: "dw-in 1s .5s cubic-bezier(.2,.7,.2,1) both" }}
          >
            <p className="eyebrow border-b border-line2 pb-3.5 font-sans">
              A turn, verbatim
            </p>
            <p className="mt-3.5">
              <span className="text-signal">you</span>
              &nbsp; is the export done yet?
            </p>
            <p className="text-faint">
              agent&nbsp; list_windows · read_window_text
            </p>
            <p>
              <span className="text-soft">reply</span>
              &nbsp; Premiere is at 84%, about 6 minutes left.
            </p>
            <p>
              <span className="text-signal">you</span>
              &nbsp;
              <span aria-live="off">{typed}</span>
              <span className="dw-caret ml-1 inline-block h-[1.1em] w-2 translate-y-[3px] bg-signal align-baseline" />
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="capabilities" className={`${SHELL} ${SECTION}`}>
          <div data-reveal className="max-w-[620px]">
            <p className="eyebrow mb-5">
              Capabilities
              <span className="dw-rule mt-4" />
            </p>
            <h2 className="font-serif text-[clamp(32px,5vw,62px)] leading-[1.02] tracking-[-0.028em]">
              Four ways in. Three of them need no screen at all.
            </h2>
          </div>

          <div
            data-reveal
            className="mt-[clamp(36px,7vh,72px)] flex flex-wrap gap-2"
          >
            {CAPABILITIES.map((cap) => {
              const active = tab === cap.id;
              return (
                <button
                  key={cap.id}
                  type="button"
                  onClick={() => setTab(cap.id)}
                  aria-pressed={active}
                  className={`rounded-full border px-5 py-2.5 text-[15px] transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] active:scale-95 ${
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-line text-soft hover:text-ink"
                  }`}
                >
                  {cap.label}
                </button>
              );
            })}
          </div>

          <div className="mt-10 lg:min-h-[300px]">
            {CAPABILITIES.filter((c) => c.id === tab).map((cap) => (
              <div
                key={cap.id}
                className="grid items-start gap-[clamp(28px,6vw,80px)] lg:grid-cols-2"
                style={{
                  animation: "dw-fade .5s cubic-bezier(.2,.7,.2,1) both",
                }}
              >
                <div>
                  <h3 className="font-serif text-[clamp(26px,3.4vw,40px)] leading-[1.1] tracking-[-0.02em]">
                    {cap.title}
                  </h3>
                  <p className="mt-5 max-w-[46ch] text-soft">{cap.body}</p>
                </div>
                <div className={cap.mono ? "font-mono text-[14px]" : "text-[15.5px]"}>
                  <p className="eyebrow border-b border-line2 pb-3 font-sans">
                    {cap.listLabel}
                  </p>
                  {cap.items.map((item, i) => (
                    <p
                      key={item.name}
                      className={`flex items-baseline justify-between gap-6 border-line2 py-2.5 text-soft ${
                        i < cap.items.length - 1 ? "border-b" : ""
                      } ${cap.mono ? "transition-[color,padding] duration-200 hover:pl-1.5 hover:text-ink" : "dw-lift"}`}
                    >
                      <span className="min-w-0 break-words">{item.name}</span>
                      {item.note && (
                        <span className="shrink-0 text-signal">{item.note}</span>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="flow" className={`${SHELL} ${SECTION}`}>
          <div data-reveal className="max-w-[620px]">
            <p className="eyebrow mb-5">
              How it works
              <span className="dw-rule mt-4" />
            </p>
            <h2 className="font-serif text-[clamp(32px,5vw,62px)] leading-[1.02] tracking-[-0.028em]">
              Install once. After that it is just a conversation.
            </h2>
          </div>

          <div className="mt-[clamp(36px,7vh,76px)]">
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                data-reveal
                style={{ transitionDelay: `${i * 0.09}s` }}
                className={`grid grid-cols-[52px_minmax(0,1fr)] items-baseline gap-x-[clamp(16px,4vw,64px)] gap-y-3 border-t border-line py-7 sm:grid-cols-[72px_minmax(0,300px)_minmax(0,1fr)] ${
                  i === STEPS.length - 1 ? "border-b" : ""
                }`}
              >
                <span className="font-serif text-[34px] leading-none text-numeral">
                  {step.n}
                </span>
                <h3 className="text-[19px] font-medium">{step.title}</h3>
                <div className="col-start-2 max-w-[52ch] text-soft sm:col-start-3">
                  <p>{step.body}</p>
                  {step.n === "01" && (
                    <div className="mt-3.5">
                      <Link
                        href="/download"
                        className="inline-flex items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-[14px] font-medium text-ink transition-colors hover:border-signal hover:text-signal"
                      >
                        <DownloadGlyph />
                        Download Windows app →
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="trust" className={`${SHELL} ${SECTION}`}>
          <div data-reveal className="max-w-[780px]">
            <p className="eyebrow mb-5">
              Privacy
              <span className="dw-rule mt-4" />
            </p>
            <h2 className="font-serif text-[clamp(32px,5.6vw,72px)] leading-[1.0] tracking-[-0.03em]">
              Your screen is never sent to a model.{" "}
              <span className="text-soft italic">
                There isn&rsquo;t one that could read it.
              </span>
            </h2>
            <p className="mt-7 max-w-[52ch] text-[clamp(16px,1.7vw,19px)] text-soft">
              The assistant receives text and nothing else: process names,
              window titles, file listings, numbers. Live view frames travel
              from your PC straight to your browser and are never stored.
            </p>
          </div>

          <div
            data-reveal
            className="mt-[clamp(40px,8vh,84px)] grid gap-x-[clamp(28px,5vw,64px)] sm:grid-cols-2 xl:grid-cols-4"
          >
            {TRUST.map((item) => (
              <div key={item.title} className="border-t border-line py-6">
                <h3 className="text-[16px] font-medium">{item.title}</h3>
                <p className="mt-2 text-[15px] text-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section id="setup" className={`${SHELL} ${SECTION}`}>
          <div data-reveal className="max-w-[620px]">
            <p className="eyebrow mb-5">
              Setup
              <span className="dw-rule mt-4" />
            </p>
            <h2 className="font-serif text-[clamp(32px,5vw,62px)] leading-[1.02] tracking-[-0.028em]">
              Two steps, once.
            </h2>
            <p className="mt-6 text-soft">
              No Python, no terminal, no config file. Ask, Act, Watch and
              Control all work the moment the machine is approved.
            </p>
          </div>

          <div
            data-reveal
            className="mt-[clamp(36px,7vh,72px)] grid gap-[clamp(28px,5vw,64px)] sm:grid-cols-2 lg:grid-cols-3"
          >
            {SETUP.map((step) => (
              <div key={step.step}>
                <p
                  className={`font-mono text-[12.5px] font-medium tracking-[0.06em] ${
                    step.dim ? "text-faint" : "text-signal"
                  }`}
                >
                  {step.step}
                </p>
                <h3 className="mt-4 mb-2.5 text-[18px] font-medium">
                  {step.title}
                </h3>
                <p className="text-[15.5px] text-soft">{step.body}</p>
              </div>
            ))}
          </div>

          <p
            data-reveal
            className="mt-[clamp(32px,6vh,64px)] text-[14.5px] text-faint"
          >
            Windows 10 or 11 · no admin rights · every service on a free tier
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section
          className={`${SHELL} ${SECTION} pb-[clamp(72px,12vh,140px)] text-center`}
        >
          <h2
            data-reveal
            className="mx-auto max-w-[18ch] font-serif text-[clamp(36px,7vw,96px)] leading-[0.98] tracking-[-0.033em]"
          >
            Stop walking back to your desk.
          </h2>
          <div
            data-reveal
            className="mt-10 flex flex-wrap items-center justify-center gap-3.5"
          >
            <Link
              href={ctaHref}
              className="rounded-full bg-ink px-7 py-[15px] text-[16px] font-medium text-paper transition-[transform,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:opacity-90"
            >
              {ctaLabel}
            </Link>
            <span className="text-[14.5px] text-faint">
              No card. One machine free, forever.
            </span>
          </div>
        </section>

        <footer className="border-t border-line">
          <div
            className={`${SHELL} flex flex-wrap items-center gap-x-9 gap-y-4 py-8 text-[14.5px] text-soft`}
          >
            <a href="#top" className="inline-flex items-center gap-3 text-ink">
              <Logo size={38} />
              <span className="font-serif text-[23px] tracking-[-0.01em] leading-none">
                DeskWarrant
              </span>
            </a>
            <span>Your PC, on a leash. From anywhere.</span>
            <span className="sm:ml-auto">
              Developed by{" "}
              <a
                href="https://www.darshtank.in"
                target="_blank"
                rel="noopener noreferrer"
                className="border-b border-line text-ink transition-colors hover:text-signal"
              >
                Darsh Tank
              </a>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* content                                                                    */
/* ========================================================================== */

const CAPABILITIES: {
  id: Capability;
  label: string;
  title: string;
  body: string;
  listLabel: string;
  mono: boolean;
  items: { name: string; note?: string }[];
}[] = [
  {
    id: "ask",
    label: "Ask",
    title: "Plain questions, one-sentence answers.",
    body: "“What's eating my CPU?” “Did the download finish?” “Is there an error on screen?” It reads live system state — processes, window titles, folder listings, CPU, memory, disk, battery — and replies in a sentence instead of a dashboard.",
    listLabel: "Read-only tools",
    mono: true,
    items: [
      { name: "list_processes" },
      { name: "list_windows" },
      { name: "read_window_text" },
      { name: "list_folder" },
      { name: "get_system_stats" },
      { name: "get_download_status" },
    ],
  },
  {
    id: "act",
    label: "Act",
    title: "Say it, and it happens.",
    body: "“Close Chrome.” “Volume to twenty.” “Open my downloads.” Every action resolves to one entry in a fixed, typed catalogue — never a shell command — and anything with consequences pauses for your confirmation, showing exactly what it is about to run.",
    listLabel: "Action tools",
    mono: true,
    items: [
      { name: "focus_window" },
      { name: "minimize_window" },
      { name: "open_path" },
      { name: "set_volume" },
      { name: "close_window", note: "confirm" },
      { name: "kill_process", note: "confirm" },
      { name: "lock_workstation", note: "confirm" },
    ],
  },
  {
    id: "watch",
    label: "Watch",
    title: "Stop checking. Get told.",
    body: "Arm a rule and walk away. Your PC evaluates it locally, every few seconds, and pushes a notification the moment it fires — whether the console is open or not.",
    listLabel: "Rules you can arm",
    mono: false,
    items: [
      { name: "A download finishes" },
      { name: "A program closes — or crashes" },
      { name: "A program starts" },
      { name: "CPU stays pegged" },
      { name: "Disk space runs low" },
      { name: "Battery runs low" },
    ],
  },
  {
    id: "control",
    label: "Control",
    title: "Take the mouse.",
    body: "Open live view and your desktop appears in the browser with full mouse and keyboard, chat still running beside it. The tunnel opens when you look and closes seconds after you stop.",
    listLabel: "Live view",
    mono: false,
    items: [
      { name: "Sharp desktop frames, tuned for text" },
      { name: "Mouse and keyboard, full control" },
      { name: "Chat stays live alongside the screen" },
      { name: "Works from a phone on mobile data" },
    ],
  },
];

const STEPS = [
  {
    n: "01",
    title: "Install it",
    body: "One installer, for your user only, so there is no administrator prompt at any point. It registers itself to come back at every logon.",
  },
  {
    n: "02",
    title: "Approve the machine",
    body: "The agent opens the console in your browser and shows a four-character code. Pick the matching one out of four. Nothing is typed, and a wrong pick denies the request outright.",
  },
  {
    n: "03",
    title: "You ask, in your own words",
    body: "The assistant chooses the tools it needs from the catalogue. Every argument is type-checked before anything is queued for the machine.",
  },
  {
    n: "04",
    title: "You get an answer",
    body: "The agent asks for work every couple of seconds, and that same request is its heartbeat. Armed rules keep running in the background and reach you by push wherever you are.",
  },
];

const TRUST = [
  {
    title: "A catalogue, not a shell",
    body: "Thirteen typed tools. The model cannot invent a command, a script, or a path.",
  },
  {
    title: "Folders you choose",
    body: "Downloads, Documents, Desktop by default — widened only at the machine itself.",
  },
  {
    title: "Reachable only while watched",
    body: "No standing session, no public endpoint. The tunnel lives as long as the view does.",
  },
  {
    title: "One machine, one owner",
    body: "Approving mints nothing. The PC must return and prove it holds a 32-byte secret before a token exists.",
  },
];

const SETUP = [
  {
    step: "STEP 01",
    title: "Sign in and get the installer",
    body: "Google sign-in, then Add a PC. Your console is live before the agent is installed.",
    dim: false,
  },
  {
    step: "STEP 02",
    title: "Run it on the machine",
    body: "It opens the console in your browser and shows a four-character code. Pick the matching one and the PC turns online.",
    dim: false,
  },
  {
    step: "STEP 03 · THERE ISN'T ONE",
    title: "Live view is already on",
    body: "No domain, no cloudflared, no port forwarding. Each machine gets its own tunnel and private subdomain when it pairs.",
    dim: true,
  },
];

/* ========================================================================== */
/* behaviour                                                                  */
/* ========================================================================== */

const QUESTIONS = [
  "tell me when it's finished",
  "then close it and lock the PC",
  "what's using all my memory?",
];

/** The hero's last line types, holds, erases, and moves to the next question. */
function useTypewriter() {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    // Reduced motion still gets the line, just already finished. Deferred by a
    // tick like the rest of the app so mount stays a single render pass.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const settle = setTimeout(() => setTyped(QUESTIONS[0]), 0);
      return () => clearTimeout(settle);
    }

    let question = 0;
    let cursor = 0;
    let erasing = false;
    let hold = 0;

    const timer = setInterval(() => {
      const full = QUESTIONS[question];
      if (!erasing) {
        cursor += 1;
        if (cursor >= full.length) {
          erasing = true;
          hold = 16;
        }
      } else if (hold > 0) {
        hold -= 1;
        return;
      } else {
        cursor -= 2;
        if (cursor <= 0) {
          cursor = 0;
          erasing = false;
          question = (question + 1) % QUESTIONS.length;
        }
      }
      setTyped(full.slice(0, Math.max(0, cursor)));
    }, 55);

    return () => clearInterval(timer);
  }, []);

  return typed;
}

/** Parks the wash under the pointer, rAF-throttled. Never runs on touch. */
function usePointerWash() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Start it somewhere deliberate; on a touch device this is where it stays.
    el.style.transform = `translate3d(${window.innerWidth * 0.5}px, ${window.innerHeight * 0.35}px, 0)`;

    if (!window.matchMedia?.("(pointer: fine)").matches) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}

/** The hairline under the header, scaled to how far down the page you are. */
function useScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const progress =
        scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
      el.style.transform = `scaleX(${progress})`;
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}

/**
 * Reveals sections as they arrive. Rescanned on an interval because the
 * capability panel swaps its children when you change tab, and anything
 * already scrolled past is shown outright rather than animated back in.
 */
function useReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") {
      document
        .querySelectorAll("[data-reveal]")
        .forEach((el) => el.classList.add("dw-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting && entry.boundingClientRect.bottom >= 0) {
            return;
          }
          entry.target.classList.add("dw-in");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );

    const scan = () => {
      document
        .querySelectorAll("[data-reveal]:not(.dw-in)")
        .forEach((el) => {
          if (el.getBoundingClientRect().bottom < 0) {
            el.classList.add("dw-in");
            return;
          }
          observer.observe(el);
        });
    };

    scan();
    const timer = setInterval(scan, 900);

    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, []);
}

function DownloadGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
