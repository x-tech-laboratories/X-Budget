// Settings: how money is written, each section's own settings, the desktop app's daemons and its own settings, sync on
// a device, and backups of a device or the server.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import type { BackupClient } from "@x-tech-laboratories/x-libs/backups";
import { currency_options, format_money, money_decimals } from "@x-tech-laboratories/x-libs/money";
import { CommitInput, NumberField, Select, Switch } from "@x-tech-laboratories/x-libs/web/react/controls";
import { PageHeading, SettingRow, SettingsPage, type SettingsCategory, type SettingsSection } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { BackupSettings } from "@x-tech-laboratories/x-libs/web/react/backup_settings";
import { TrustedCertificates } from "@x-tech-laboratories/x-libs/web/react/certificates";
import { ConnectionSettings } from "@x-tech-laboratories/x-libs/web/react/connections";
import { PeerListeningSettings, SyncSettings } from "@x-tech-laboratories/x-libs/web/react/sync_settings";

import type { BackupFolder } from "../../shared/bridge.ts";
import type { DesktopSettings } from "../../shared/desktop.ts";
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

// The desktop app's own settings, which belong to this computer and do not sync.
function Desktop() {
  const { desktop } = page();
  const [settings, set_settings] = useState<DesktopSettings | null>(null);
  useEffect(() => void desktop?.get_desktop_settings().then(set_settings, () => undefined), [desktop]);
  if (!desktop || !settings) return null;

  const change = (key: keyof DesktopSettings, on: boolean): void => {
    set_settings({ ...settings, [key]: on });
    attempt(desktop.set_desktop_setting(key, on));
  };
  return (
    <>
      <SettingRow label="Keep running in the background" hint="Sync and backups carry on with the window closed. Turned off, they stop shortly after the last window closes." as_label>
        <Switch label="Keep running in the background" checked={settings.keep_running_in_background} on_change={(on) => change("keep_running_in_background", on)} />
      </SettingRow>
      <SettingRow label="Start at login" hint="Starts X-Budget in the background when you log in, without opening its window." as_label>
        <Switch label="Start at login" checked={settings.start_at_login} disabled={!settings.keep_running_in_background} on_change={(on) => change("start_at_login", on)} />
      </SettingRow>
      <SettingRow label="Quit completely" hint="Closes the window and stops X-Budget in the background too, until you open it again.">
        <button type="button" onClick={() => attempt(desktop.quit_completely())}>Quit completely</button>
      </SettingRow>
    </>
  );
}

// A desktop window on a server's daemon works on the server's budgets, as a browser does.
function storage_category(is_admin: boolean): SettingsCategory[] {
  const { backups, backup_folder, certificates, connections, desktop, device, host, peer_listening } = page();
  const on_server = host === "web" || (host === "desktop" && !device);
  const sections: SettingsSection[] = [];
  if (connections) {
    sections.push({ id: "connections", heading: "Connections", hint: "The budgets this window works on: This computer's own, or an X-Budget server's.", content: <>
      <ConnectionSettings client={connections} certificates={certificates} placeholder="https://budget.example.org" />
      {!device && certificates && <TrustedCertificates certificates={certificates} />}
    </> });
  }
  if (desktop) sections.push({ id: "desktop", heading: "Desktop app", content: <Desktop /> });
  if (device && (!on_server || is_admin)) {
    sections.push({ id: "sync", heading: "Sync", hint: on_server ? "Keep the server's budgets alike with the devices paired with it." : "Keep this device's budgets alike with your other devices and your X-Budget server.", content: <SyncSettings device={device} subscribe={(listener) => data_watch.subscribe(listener)} data_name="budgets" extra={peer_listening && <PeerListeningSettings listening={peer_listening} />} /> });
  }
  if (backups && (!on_server || is_admin)) {
    const hint = on_server ? "The server's budgets, kept in its data folder." : "This device's budgets, kept beside its database.";
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
