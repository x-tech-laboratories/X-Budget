// Settings every device shares, such as the currency amounts are shown in, kept as JSON values by key so each feature
// can add its own.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";

import { define_feature } from "./feature.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

export type Settings = Record<string, unknown>;

export const common_setting_defaults = {
  // An ISO 4217 code such as "USD" or "JMD".
  currency: "USD",
  // A locale such as "en-US"; empty uses the reader's own.
  locale: "",
  // Places amounts are kept and shown with; 0 budgets in whole units.
  decimals: 2,
} satisfies Settings;

// One stored value, or the fallback when it was never set.
export function read_setting(database: SqlDatabase, key: string, fallback: unknown): unknown {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : fallback;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const settings_feature = define_feature({
  id: "settings",
  migrations: [`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`],
  tables: [{ name: "settings", key_columns: ["key"] }],
  methods: {
    // Only the values set; the page lays them over the defaults.
    get_settings: (database: SqlDatabase): Settings => {
      const rows = database.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
      return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    },
    set_setting: (database: SqlDatabase, key: string, value: unknown): void => {
      database.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
    },
  },
  setting_defaults: common_setting_defaults,
});
