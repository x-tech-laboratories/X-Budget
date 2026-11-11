// The one database every X-Budget device keeps: every feature's tables brought up to date, sync set to stamp every
// change, and every feature's calls in one table the page reaches through whichever host it runs on.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { ApiSpec } from "@x-tech-laboratories/x-libs/api_spec";
import { migrate, type SqlDatabase } from "@x-tech-laboratories/x-libs/sql";
import { create_sync_engine } from "@x-tech-laboratories/x-libs/sync_engine";

import { budget_feature } from "./budget/store.ts";
import { common_setting_defaults, read_setting, settings_feature } from "./settings.ts";

// ── Features ─────────────────────────────────────────────────────────────────

export const features = [settings_feature, budget_feature];

const histories = features.flatMap((feature) => feature.histories ?? []);

// A history's versions sync like its items; versions are recorded by the device that made a change, never on arrival.
export const sync_engine = create_sync_engine({
  tables: [...features.flatMap((feature) => feature.tables), ...histories.map((history) => history.synced_table)],
  after_apply: (database) => histories.forEach((history) => history.forget_touched(database)),
});

export const setting_defaults = Object.assign({}, ...features.map((feature) => feature.setting_defaults ?? {})) as Record<string, unknown>;

// ── Opening ──────────────────────────────────────────────────────────────────

// Whether a database already holding data has steps to run, so it can be backed up before its schema is upgraded.
export function needs_upgrade(database: SqlDatabase): boolean {
  const has_versions = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_versions'").get();
  if (!has_versions) return false;
  return features.some((feature) => {
    const row = database.prepare("SELECT version FROM schema_versions WHERE owner = ?").get(feature.id) as { version: number } | undefined;
    return (row?.version ?? 0) < feature.migrations.length;
  });
}

// Brings an open connection up to date and sets sync to stamp every change; run once each time the database opens.
export function open_store(database: SqlDatabase): void {
  database.exec("PRAGMA foreign_keys = ON");
  // Each feature keeps its own schema version, so features grow apart without renumbering each other's steps.
  for (const feature of features) migrate(database, feature.migrations, { owner: feature.id });
  for (const history of histories) history.install(database);
  sync_engine.install(database);
  prune_history(database);
}

// Versions older than the days set go, each item keeping its newest; 0 keeps them all.
function prune_history(database: SqlDatabase): void {
  const days = Math.floor(Number(read_setting(database, "history_days", common_setting_defaults.history_days)));
  if (!(days > 0)) return;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  for (const history of histories) history.prune(database, cutoff);
}

// Saves a version of each item the last write touched.
function record_history(database: SqlDatabase): void {
  for (const history of histories) history.record(database);
}

// ── Calls ────────────────────────────────────────────────────────────────────

const all_methods = Object.assign({}, ...features.map((feature) => feature.methods)) as typeof settings_feature.methods & typeof budget_feature.methods;

type Bound<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (database: SqlDatabase, ...args: infer Args) => infer Result ? (...args: Args) => Result : never;
};

// Every call the page can make, as it makes them, without the database.
export type BudgetMethods = Bound<typeof all_methods>;

export const method_names = Object.keys(all_methods) as (keyof BudgetMethods & string)[];

// Every call described once, for MCP and OpenAPI.
export const budget_api_spec = Object.assign({}, ...features.map((feature) => feature.api)) as ApiSpec<BudgetMethods>;

export function is_read_only(method: string): boolean {
  return /^(list|get|search|lookup|export)_/.test(method);
}

// The calls run on the database given, telling on_change after each write so the other pages and devices hear of it.
export function bind_methods(database: () => SqlDatabase, on_change: () => void): BudgetMethods {
  const bound = method_names.map((name) => {
    const method = all_methods[name] as (database: SqlDatabase, ...args: unknown[]) => unknown;
    const call = (...args: unknown[]): unknown => {
      const result = method(database(), ...args);
      if (is_read_only(name)) return result;
      const done = (value: unknown) => {
        record_history(database());
        on_change();
        return value;
      };
      return result instanceof Promise ? result.then(done) : done(result);
    };
    return [name, call];
  });
  return Object.fromEntries(bound) as BudgetMethods;
}
