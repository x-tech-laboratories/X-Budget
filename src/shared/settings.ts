// Settings every device shares, such as the currency amounts are shown in, kept as JSON values by key in the X-Libs
// settings store, each feature declaring its own keys.

// ── Imports ──────────────────────────────────────────────────────────────────

import { create_settings_store, settings_of, type SettingSpec } from "@x-tech-laboratories/x-libs/settings";

import { define_feature } from "./feature.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

export type { Settings } from "@x-tech-laboratories/x-libs/settings";

export const common_setting_defaults = {
  // An ISO 4217 code such as "USD" or "JMD".
  currency: "USD",
  // A locale such as "en-US"; empty uses the reader's own.
  locale: "",
  // Places amounts are kept and shown with; 0 budgets in whole units.
  decimals: 2,
  // How many days of changes the history keeps, each item keeping its newest version; 0 keeps them all.
  history_days: 365,
};

// The settings row holding this device's backup schedule.
export const backup_schedule_key = "backup_schedule";

const common_settings: Record<string, SettingSpec> = {
  ...settings_of(common_setting_defaults),
  // How this device backs up is its own, never synced.
  [backup_schedule_key]: { local: true },
};

// ── Store ────────────────────────────────────────────────────────────────────

// The settings feature over every other feature's settings, so they share one table and one set of calls.
export function create_settings_feature(features: readonly { settings?: Record<string, SettingSpec> }[]) {
  const store = create_settings_store([common_settings, ...features.map((feature) => feature.settings ?? {})], {
    app: { id: "x-budget", name: "X-Budget" },
    descriptions: {
      get_settings: "Every setting by key, such as currency, decimals and budget.rollup_mode, the ones never set at their defaults.",
      set_setting: "Sets one setting, such as currency to JMD or budget.rollup_mode to cap.",
    },
    key_example: "currency",
  });
  const feature = define_feature({ id: store.id, migrations: store.migrations.map(String), tables: store.tables, methods: { ...store.methods }, api: store.api });
  return { store, feature };
}
