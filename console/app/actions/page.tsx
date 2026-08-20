import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { CopyPrompt } from "@/components/CopyPrompt";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Eyebrow, Panel, Tag } from "@/components/ui";
import { TOOLS, type ToolDefinition } from "@/lib/assistant/tools";
import {
  CHAINED_EXAMPLES,
  TOOL_GUIDE,
  WATCH_GUIDE,
} from "@/lib/assistant/guide";

export const metadata = {
  title: "What it can do · DeskWarrant",
  description:
    "Every action the DeskWarrant agent can take on a paired Windows PC, with a copyable prompt for each.",
};

/*
  Public on purpose. This page is what someone reads BEFORE deciding whether to
  put an agent on their PC, so putting it behind the sign-in wall would hide it
  from exactly the audience it is written for. It renders no device data and
  makes no authenticated call -- the catalog it describes is the same for
  everyone.
*/

const readTools = TOOLS.filter((t) => t.kind === "read");
const everydayActions = TOOLS.filter(
  (t) => t.kind === "action" && !t.requiresConfirmation,
);
const guardedActions = TOOLS.filter(
  (t) => t.kind === "action" && t.requiresConfirmation,
);

export default async function ActionsPage() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/[0.88] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-3 text-ink"
            title="Back to home"
          >
            <Logo size={34} />
            <span className="font-serif text-[22px] leading-none tracking-[-0.01em]">
              DeskWarrant
            </span>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeToggle className="p-1.5" />
            {signedIn ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/devices"
                  className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
                >
                  Go to Console
                </Link>
                <form
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                  className="hidden sm:block"
                >
                  <button
                    type="submit"
                    className="rounded-full border border-line px-3.5 py-1.5 text-[13px] text-soft transition-colors hover:text-ink"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <Link
                href="/signin?next=/actions"
                className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        {/* ---------- Hero ---------- */}
        <section>
          <Eyebrow>Reference</Eyebrow>
          <h1 className="mt-3 max-w-[18ch] font-serif text-[clamp(34px,6vw,58px)] leading-[1.02] tracking-[-0.028em]">
            What you can ask it to do
          </h1>
          <p className="mt-5 max-w-[62ch] text-[17px] leading-relaxed text-soft">
            DeskWarrant answers questions about your PC and acts on it in plain
            language. It cannot improvise: every action it takes comes from the{" "}
            {TOOLS.length} entries below, and it supplies typed arguments to
            them rather than writing commands. Each one has a prompt you can
            copy straight into the chat.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <Panel className="p-4">
              <p className="font-mono text-[12px] text-faint">
                {readTools.length} read · {everydayActions.length + guardedActions.length} act
              </p>
              <p className="mt-1.5 text-[14px] leading-snug text-soft">
                Two thirds of what it can do only looks; nothing changes.
              </p>
            </Panel>
            <Panel className="p-4">
              <p className="font-mono text-[12px] text-faint">
                {guardedActions.length} ask first
              </p>
              <p className="mt-1.5 text-[14px] leading-snug text-soft">
                Anything that cannot be undone stops and waits for you.
              </p>
            </Panel>
            <Panel className="p-4">
              <p className="font-mono text-[12px] text-faint">0 screenshots</p>
              <p className="mt-1.5 text-[14px] leading-snug text-soft">
                Your screen is never sent to any AI model, ever.
              </p>
            </Panel>
          </div>
        </section>

        {/* ---------- Ask ---------- */}
        <Section
          eyebrow="Ask"
          title="Questions about the machine"
          lede="Read-only. These never change anything, so they never stop to ask permission — the answers come from real system data rather than a guess."
        >
          <ToolGrid tools={readTools} />
        </Section>

        {/* ---------- Act ---------- */}
        <Section
          eyebrow="Act"
          title="Things it can do for you"
          lede="Every one of these is reversible by hand in a second, so they run as soon as you ask."
        >
          <ToolGrid tools={everydayActions} />
        </Section>

        <Section
          eyebrow="Act · guarded"
          title="Things it asks about first"
          lede="These either lose work or lock you out, so the agent stops and shows you the exact action and its target before anything happens. You approve or you don't."
        >
          <ToolGrid tools={guardedActions} />
        </Section>

        {/* ---------- Chained ---------- */}
        <Section
          eyebrow="Together"
          title="One sentence, several steps"
          lede="The useful part is not any single action — it is finding the right target first and then acting on that one. You do not have to spell the steps out."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {CHAINED_EXAMPLES.map((example) => (
              <Panel key={example.prompt} className="flex flex-col p-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {example.steps.map((step, index) => (
                    <span key={step} className="flex items-center gap-1.5">
                      {index > 0 && (
                        <span aria-hidden="true" className="text-faint">
                          →
                        </span>
                      )}
                      <code className="font-mono text-[12px] text-faint">
                        {step}
                      </code>
                    </span>
                  ))}
                </div>
                <CopyPrompt text={example.prompt} />
                <p className="mt-3 text-[13px] leading-relaxed text-faint">
                  {example.note}
                </p>
              </Panel>
            ))}
          </div>
        </Section>

        {/* ---------- Watch ---------- */}
        <Section
          eyebrow="Watch"
          title="Things it tells you without being asked"
          lede="Set these up once from the device panel and the PC pushes a notification when the condition first becomes true. They are checked on the PC itself, so they work whether or not you have the console open."
        >
          <Panel className="divide-y divide-line">
            {WATCH_GUIDE.map((rule) => (
              <div
                key={rule.label}
                className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <p className="shrink-0 text-[14px] font-medium sm:w-[150px]">
                  {rule.label}
                </p>
                <p className="text-[14px] leading-relaxed text-soft">
                  {rule.fires}
                </p>
              </div>
            ))}
          </Panel>
          <p className="mt-4 text-[13px] leading-relaxed text-faint">
            Each rule fires on the change into its condition, not repeatedly
            while it holds — “disk below 10%” tells you once, not every fifteen
            seconds until you clear space.
          </p>
        </Section>

        {/* ---------- Control ---------- */}
        <Section
          eyebrow="Control"
          title="When you would rather just use it"
          lede="Some things are quicker to do than to describe. Live view puts the screen in your browser with working mouse and keyboard, and the chat panel stays live beside it."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Panel className="p-5">
              <p className="text-[14px] font-medium">Full screen</p>
              <p className="mt-2 text-[13px] leading-relaxed text-soft">
                Fills the display and captures the shortcuts a browser would
                normally swallow, so Ctrl+W closes the window on your PC rather
                than the tab in front of you.
              </p>
            </Panel>
            <Panel className="p-5">
              <p className="text-[14px] font-medium">Rotate</p>
              <p className="mt-2 text-[13px] leading-relaxed text-soft">
                Turns the picture in quarter steps for a monitor that is
                physically rotated, or to fit a phone held upright. Clicks and
                keystrokes follow the turn.
              </p>
            </Panel>
            <Panel className="p-5">
              <p className="text-[14px] font-medium">On demand only</p>
              <p className="mt-2 text-[13px] leading-relaxed text-soft">
                The PC becomes reachable while the view is open and stops being
                reachable seconds after you close it. Frames are never stored.
              </p>
            </Panel>
          </div>
        </Section>

        {/* ---------- Boundaries ---------- */}
        <Section
          eyebrow="Limits"
          title="What it deliberately cannot do"
          lede="These are not features that are missing yet. They are the shape of the thing — several of them are the reason the rest is safe to give an agent at all."
        >
          <Panel className="divide-y divide-line">
            <Limit title="Reach most of your disk">
              Files are limited to Downloads, Documents, Desktop, Pictures and
              Videos. Windows, Program Files and ProgramData are refused
              outright, and a path that tries to climb out of an allowed folder
              is resolved before it is checked, so it cannot sneak past.
            </Limit>
            <Limit title="Open a terminal">
              Command Prompt, PowerShell, Windows Terminal, Git Bash, WSL,
              Python, Node and the registry editor are all excluded from the
              apps it can launch.
            </Limit>
            <Limit title="Run commands or code">
              There is no tool that takes a command. The model picks a name from
              the list on this page and fills in typed arguments; it has no way
              to express anything else, so text it reads from a window or a
              filename cannot become an instruction.
            </Limit>
            <Limit title="Type into your programs">
              It can focus, close and launch windows, but it cannot send
              keystrokes into them — except while you are driving live view
              yourself.
            </Limit>
            <Limit title="Shut down, restart, or unlock">
              None of these exist. It also cannot see or touch the lock screen
              or a Windows permission prompt: it runs without administrator
              rights, on purpose.
            </Limit>
            <Limit title="Show your screen to an AI model">
              The assistant only ever receives text — window titles, process
              names, file listings, numbers. No image is sent to any model, and
              there is no vision model anywhere in the system.
            </Limit>
          </Panel>
        </Section>

        {/* ---------- CTA ---------- */}
        <section className="mt-20 border-t border-line pt-10">
          <h2 className="max-w-[20ch] font-serif text-[clamp(24px,3.4vw,34px)] leading-[1.06] tracking-[-0.02em]">
            {signedIn ? "Try one on your own PC." : "Point it at your own PC."}
          </h2>
          <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-soft">
            {signedIn
              ? "Copy any prompt above into the chat on one of your devices."
              : "Pairing takes a minute and needs no account on the PC itself."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={signedIn ? "/devices" : "/download"}
              className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-paper transition-opacity hover:opacity-85"
            >
              {signedIn ? "Go to your devices" : "Add a PC"}
            </Link>
            <Link
              href="/"
              className="rounded-full border border-line px-5 py-2.5 text-[14px] font-medium text-soft transition-colors hover:border-ink/35 hover:text-ink"
            >
              How it works
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20 border-t border-line pt-10">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 max-w-[22ch] font-serif text-[clamp(26px,4vw,38px)] leading-[1.06] tracking-[-0.022em]">
        {title}
      </h2>
      <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-soft">
        {lede}
      </p>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function ToolGrid({ tools }: { tools: ToolDefinition[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} />
      ))}
    </div>
  );
}

function ToolCard({ tool }: { tool: ToolDefinition }) {
  // Guaranteed present: guide.ts fails the build if a tool has no entry.
  const guide = TOOL_GUIDE[tool.name];

  return (
    <Panel className="flex flex-col p-5">
      <div className="flex flex-wrap items-center gap-2">
        <code className="font-mono text-[12.5px] text-faint">{tool.name}</code>
        {/* Rendered from the catalog, never from a copy of it: a tool that
            becomes destructive must not keep an old, reassuring badge. */}
        {tool.requiresConfirmation && <Tag tone="warn">Asks first</Tag>}
      </div>

      <CopyPrompt text={guide.prompt} />

      <p className="mt-3 text-[13px] leading-relaxed text-faint">
        {guide.result}
      </p>
    </Panel>
  );
}

function Limit({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4 sm:flex-row sm:gap-6">
      <p className="shrink-0 text-[14px] font-medium sm:w-[190px]">{title}</p>
      <p className="text-[14px] leading-relaxed text-soft">{children}</p>
    </div>
  );
}
