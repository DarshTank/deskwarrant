"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface CatalogEntry {
  template: string;
  label: string;
  description: string;
  defaults: Record<string, unknown>;
}

interface Rule {
  id: string;
  template: string;
  params: Record<string, unknown>;
  enabled: boolean;
  cooldownSeconds: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export function WatchRules({ deviceId }: { deviceId: string }) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    template: string;
    params: Record<string, unknown>;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ catalog: CatalogEntry[]; rules: Rule[] }>(
        `/api/devices/${deviceId}/watch-rules`,
      );
      setCatalog(data.catalog);
      setRules(data.rules);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load rules.");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    // Deferred by a tick so the fetch does not set state synchronously during
    // the effect, which would cascade an extra render on mount.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function create() {
    if (!draft) return;
    try {
      await api(`/api/devices/${deviceId}/watch-rules`, {
        method: "POST",
        json: { template: draft.template, params: draft.params },
      });
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the rule.");
    }
  }

  async function toggle(rule: Rule) {
    try {
      await api(`/api/devices/${deviceId}/watch-rules/${rule.id}`, {
        method: "PATCH",
        json: { enabled: !rule.enabled },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the rule.");
    }
  }

  async function remove(rule: Rule) {
    try {
      await api(`/api/devices/${deviceId}/watch-rules/${rule.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the rule.");
    }
  }

  return (
    <div className="thin-scroll flex-1 overflow-y-auto px-[clamp(12px,3vw,24px)] py-6">
      <div className="max-w-[62ch]">
        <p className="eyebrow">Watch rules</p>
        <h2 className="mt-3 font-serif text-[clamp(24px,3.4vw,32px)] leading-[1.08] tracking-[-0.02em]">
          Stop checking.{" "}
          <span className="text-soft italic">Get told.</span>
        </h2>
        <p className="mt-4 text-[15px] text-soft">
          The PC evaluates these locally every fifteen seconds and pushes a
          notification the moment one fires. They come from a fixed catalogue —
          you parameterise them, you cannot author new ones, and that is what
          keeps rule evaluation a small auditable amount of code on the agent.
        </p>
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-danger/25 bg-danger/[0.07] px-4 py-3 text-[14px] text-danger">
          {error}
        </p>
      )}

      {loading && <p className="mt-8 text-[15px] text-faint">Loading…</p>}

      {!loading && rules.length === 0 && (
        <p className="mt-8 text-[15px] text-faint">
          Nothing armed yet. Pick one below and it starts watching immediately.
        </p>
      )}

      {!loading && rules.length > 0 && (
        <ul className="mt-8 grid gap-3 lg:grid-cols-2">
          {rules.map((rule) => {
            const entry = catalog.find((c) => c.template === rule.template);
            return (
              <li
                key={rule.id}
                className={`rounded-2xl border p-5 transition-colors ${
                  rule.enabled
                    ? "border-line bg-raised"
                    : "border-line2 bg-transparent"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2.5 text-[16px] font-medium">
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${
                          rule.enabled ? "bg-signal dw-beat" : "bg-offline"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {entry?.label ?? rule.template}
                      </span>
                    </p>
                    <p className="mt-2 font-mono text-[12px] break-all text-soft">
                      {JSON.stringify(rule.params)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void toggle(rule)}
                      className="rounded-full border border-line px-3 py-1 text-[12px] text-soft transition-colors hover:border-ink/35 hover:text-ink"
                    >
                      {rule.enabled ? "Disarm" : "Arm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(rule)}
                      aria-label="Delete rule"
                      className="rounded-full border border-line px-3 py-1 text-[12px] text-soft transition-colors hover:border-danger/45 hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <p className="mt-4 border-t border-line2 pt-3 font-mono text-[11.5px] text-faint">
                  cooldown {rule.cooldownSeconds}s ·{" "}
                  {rule.lastTriggeredAt
                    ? `last fired ${new Date(rule.lastTriggeredAt).toLocaleString()}`
                    : "never fired"}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-10 rounded-2xl border border-line bg-raised p-5 sm:p-6">
        <p className="eyebrow">Arm a rule</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {catalog.map((entry) => {
            const active = draft?.template === entry.template;
            return (
              <button
                key={entry.template}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setDraft({
                    template: entry.template,
                    params: { ...entry.defaults },
                  })
                }
                className={`rounded-full border px-4 py-1.5 text-[13.5px] transition-colors ${
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-line text-soft hover:border-ink/35 hover:text-ink"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        {draft && (
          <div className="mt-6 border-t border-line2 pt-5">
            <p className="max-w-[58ch] text-[14.5px] text-soft">
              {catalog.find((c) => c.template === draft.template)?.description}
            </p>

            <div className="mt-5 grid gap-4 sm:max-w-md">
              {Object.entries(draft.params).map(([key, value]) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block font-mono text-[11px] tracking-[0.08em] text-faint uppercase">
                    {key}
                  </span>
                  <input
                    value={String(value ?? "")}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next =
                        typeof value === "number" ? Number(raw) || 0 : raw;
                      setDraft({
                        ...draft,
                        params: { ...draft.params, [key]: next },
                      });
                    }}
                    className="w-full rounded-full border border-line bg-paper px-4 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-signal"
                  />
                </label>
              ))}
              {Object.keys(draft.params).length === 0 && (
                <p className="text-[14px] text-faint">
                  This rule takes no parameters.
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void create()}
                className="rounded-full bg-ink px-5 py-2 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-85"
              >
                Arm it
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-full border border-line px-5 py-2 text-[13.5px] font-medium text-soft transition-colors hover:border-ink/35 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
