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
    <div className="thin-scroll flex-1 overflow-y-auto px-4 py-4">
      <p className="text-sm text-muted">
        The PC checks these locally every 15 seconds and pushes a notification
        when one fires. Rules come from a fixed catalog.
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading && <p className="mt-4 text-sm text-muted">Loading…</p>}

      {!loading && rules.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rules.map((rule) => {
            const entry = catalog.find((c) => c.template === rule.template);
            return (
              <li
                key={rule.id}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {entry?.label ?? rule.template}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted">
                      {JSON.stringify(rule.params)}
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      Cooldown {rule.cooldownSeconds}s ·{" "}
                      {rule.lastTriggeredAt
                        ? `last fired ${new Date(rule.lastTriggeredAt).toLocaleString()}`
                        : "never fired"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void toggle(rule)}
                      className="rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:bg-background"
                    >
                      {rule.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(rule)}
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-danger transition-colors hover:bg-danger/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium">Add a rule</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {catalog.map((entry) => (
            <button
              key={entry.template}
              type="button"
              onClick={() =>
                setDraft({
                  template: entry.template,
                  params: { ...entry.defaults },
                })
              }
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                draft?.template === entry.template
                  ? "border-accent text-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {draft && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">
              {catalog.find((c) => c.template === draft.template)?.description}
            </p>
            {Object.entries(draft.params).map(([key, value]) => (
              <label key={key} className="block">
                <span className="text-xs text-muted">{key}</span>
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
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
              </label>
            ))}
            {Object.keys(draft.params).length === 0 && (
              <p className="text-xs text-muted">
                This rule takes no parameters.
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void create()}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90"
              >
                Add rule
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-background"
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
