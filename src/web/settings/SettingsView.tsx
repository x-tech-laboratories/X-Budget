// Settings: how money is written, each section's own settings, sync on a device, and backups of a device or the server.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { BackupClient } from "@x-tech-laboratories/x-libs/backups";
import { currency_options, format_money, money_decimals } from "@x-tech-laboratories/x-libs/money";
import { CommitInput, NumberField, Select } from "@x-tech-laboratories/x-libs/web/react/controls";
import { PageHeading, SettingRow, SettingsPage, type SettingsCategory, type SettingsSection } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { BackupSettings } from "@x-tech-laboratories/x-libs/web/react/backup_settings";
import { TrustedCertificates } from "@x-tech-laboratories/x-libs/web/react/certificates";
import { SyncSettings } from "@x-tech-laboratories/x-libs/web/react/sync_settings";

import type { BackupFolder } from "../../shared/bridge.ts";
import { calls, data_watch, page, use_settings } from "../api.ts";
import { attempt } from "../budget/common.tsx";
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

// ── Page ─────────────────────────────────────────────────────────────────────

// A device syncs and keeps its own backups; a browser shows the server's backups, which only an admin manages.
// A phone's backups go in a folder picked once in its storage, where file managers and sync apps reach them.
function FolderBackups({ backups, folder }: { backups: BackupClient; folder: BackupFolder }) {
  const [name, set_name] = useState<string | null>(null);
  useEffect(() => void folder.name().then(set_name), [folder]);

  const folder_row = (
    <SettingRow label="Backup folder" hint={name ? undefined : "Pick a folder in the phone's storage; backups start once one is picked."}>
      {name && <span>{name}</span>}
      <button type="button" onClick={() => attempt(folder.choose().then(set_name))}>{name ? "Change folder…" : "Choose folder…"}</button>
    </SettingRow>
  );
  // Drawn afresh for a new folder, so its backups are listed.
  return <BackupSettings key={name ?? ""} device={backups} data_name="budgets" on_restored={() => location.reload()} folder_row={folder_row} can_back_up={Boolean(name)} />;
}

function storage_category(is_admin: boolean): SettingsCategory[] {
  const { backups, backup_folder, certificates, device, host } = page();
  const sections: SettingsSection[] = [];
  if (device) {
    sections.push({ id: "sync", heading: "Sync", hint: "Keep this device's budgets alike with your X-Budget server.", content: <>
      <SyncSettings device={device} certificates={certificates} subscribe={(listener) => data_watch.subscribe(listener)} data_name="budgets" placeholder="https://budget.example.org/" />
      {certificates && <TrustedCertificates certificates={certificates} />}
    </> });
  }
  if (backups && (host !== "web" || is_admin)) {
    const hint = host === "web" ? "The server's budgets, kept in its data folder." : "This device's budgets, kept beside its database.";
    const content = backup_folder ? <FolderBackups backups={backups} folder={backup_folder} /> : <BackupSettings device={backups} data_name="budgets" on_restored={() => location.reload()} />;
    sections.push({ id: "backups", heading: "Backups", hint: backup_folder ? "This device's budgets, kept in a folder of the phone's storage." : hint, content });
  }
  return sections.length === 0 ? [] : [{ heading: host === "web" ? "Server" : "This device", sections }];
}

export function SettingsView({ is_admin = true }: { is_admin?: boolean }) {
  const settings = use_settings();
  const set_setting = (key: string, value: unknown) => calls().set_setting(key, value);

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
              ...storage_category(is_admin),
            ]}
          />
        )}
      </Loaded>
    </>
  );
}
