// Settings: how money is written, each section's own settings, and on a device, sync with a server.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { StatusPill } from "@x-tech-laboratories/x-libs/web/react/badges";
import { currency_options, format_money, money_decimals } from "@x-tech-laboratories/x-libs/money";
import { CommitInput, NumberField, Select } from "@x-tech-laboratories/x-libs/web/react/controls";
import { PageHeading, SettingRow, SettingsPage, type SettingsSection } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { toast } from "@x-tech-laboratories/x-libs/web/react/toasts";
import type { SyncDirection, SyncStatus } from "@x-tech-laboratories/x-libs/sync_protocol";

import { calls, data_watch, page, use_settings } from "../api.ts";
import { page_features } from "../features.tsx";

// ── Money ────────────────────────────────────────────────────────────────────

function money_section(settings: Record<string, unknown>, set_setting: (key: string, value: unknown) => Promise<void>): SettingsSection {
  const currency = String(settings.currency || "USD");
  const locale = String(settings.locale ?? "");
  const decimals = money_decimals(settings.decimals);
  const options = currency_options(locale || undefined);
  return {
    id: "money",
    heading: "Money",
    hint: `Amounts look like ${format_money(-1234.5, { currency, locale, decimals })}.`,
    content: (
      <>
        <SettingRow label="Currency">
          <Select label="Currency" bare options={options.some(([code]) => code === currency) ? options : [[currency, currency], ...options]} value={currency} on_change={(code) => void set_setting("currency", code)} />
        </SettingRow>
        <SettingRow label="Locale" hint="Such as en-US or en-JM, for how numbers and months are written. Empty uses this device's." as_label>
          <CommitInput
            type="text"
            placeholder="This device's"
            value={locale}
            on_commit={(event) => {
              const next = event.currentTarget.value.trim();
              if (next !== locale) void set_setting("locale", next);
            }}
          />
        </SettingRow>
        <SettingRow label="Decimal places" hint="Amounts are kept and shown with this many; typing more rounds to it. 0 budgets in whole units.">
          <NumberField bare label="Decimal places" value={decimals} min={0} max={6} on_change={(value) => value !== null && value !== decimals && void set_setting("decimals", Math.round(value))} />
        </SettingRow>
      </>
    ),
  };
}

// ── Sync ─────────────────────────────────────────────────────────────────────

const sync_tones = { off: "none", idle: "good", syncing: "info", offline: "warn", needs_setup: "warn", failed: "bad" } as const;

function SyncSettings() {
  const device = page().device!;
  const [status, set_status] = useState<SyncStatus | null>(null);
  const [server_url, set_server_url] = useState("");
  const [token, set_token] = useState("");

  useEffect(() => {
    const read = () => void device.get_sync_status().then(set_status);
    read();
    return data_watch.subscribe(read);
  }, [device]);

  async function connect(direction: SyncDirection): Promise<void> {
    try {
      set_status(await device.connect_sync(server_url || status?.server_url || "", token, direction));
      set_token("");
      toast(direction === "download" ? "This device now has the server's data" : "The server now has this device's data", { tone: "good" });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { tone: "bad" });
    }
  }

  if (!status) return null;
  return (
    <>
      <SettingRow label="Status">
        <StatusPill tone={sync_tones[status.state]} busy={status.state === "syncing"} label={status.state === "off" ? "Not syncing" : `${status.state}${status.error ? `: ${status.error}` : ""}`} />
      </SettingRow>
      {status.state !== "off" && status.state !== "needs_setup" ? (
        <SettingRow label={status.server_url} hint={`${status.pending_changes} changes waiting · last synced ${status.last_synced_at || "never"}`}>
          <button type="button" onClick={() => void device.sync_now().then(set_status)}>Sync now</button>
          <button type="button" onClick={() => void device.disconnect_sync().then(set_status)}>Stop syncing</button>
        </SettingRow>
      ) : (
        <>
          <SettingRow label="Server address" as_label>
            <input type="url" placeholder="https://budget.example.org/" defaultValue={status.server_url} onChange={(event) => set_server_url(event.currentTarget.value)} />
          </SettingRow>
          <SettingRow label="Access token" as_label>
            <input type="password" autoComplete="off" value={token} onChange={(event) => set_token(event.currentTarget.value)} />
          </SettingRow>
          <SettingRow label="First sync" hint="Which copy wins the first time; the other is backed up before it is replaced.">
            <button type="button" onClick={() => void connect("download")}>Use the server's data</button>
            <button type="button" onClick={() => void connect("upload")}>Use this device's data</button>
          </SettingRow>
        </>
      )}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SettingsView() {
  const settings = use_settings();
  const set_setting = (key: string, value: unknown) => calls().set_setting(key, value);
  const has_device = page().device !== null;

  return (
    <>
      <PageHeading title="Settings" />
      <Loaded resource={settings}>
        {(values) => (
          <SettingsPage
            categories={[
              { heading: "General", sections: [money_section(values, set_setting)] },
              ...page_features
                .map((feature) => ({ heading: feature.label, sections: feature.settings({ settings: values, set_setting }) }))
                .filter((category) => category.sections.length > 0),
              ...(has_device ? [{ heading: "This device", sections: [{ id: "sync", heading: "Sync", hint: "Keep this device's data alike with your X-Budget server.", content: <SyncSettings /> }] }] : []),
            ]}
          />
        )}
      </Loaded>
    </>
  );
}
