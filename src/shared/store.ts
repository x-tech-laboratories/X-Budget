// The one database every X-Budget device keeps: every feature's tables brought up to date, sync set to stamp every
// change, and every feature's calls in one table the page reaches through whichever host it runs on.

// ── Imports ──────────────────────────────────────────────────────────────────

import { migrate, type SqlDatabase } from "@x-tech-laboratories/x-libs/sql";
import { create_sync_engine } from "@x-tech-laboratories/x-libs/sync_engine";

import { budget_feature } from "./budget/store.ts";
import { settings_feature } from "./settings.ts";

// ── Features ─────────────────────────────────────────────────────────────────

export const features = [settings_feature, budget_feature];

export const sync_engine = create_sync_engine({ tables: features.flatMap((feature) => feature.tables) });

export const setting_defaults = Object.assign({}, ...features.map((feature) => feature.setting_defaults ?? {})) as Record<string, unknown>;

// ── Opening ──────────────────────────────────────────────────────────────────

// Brings an open connection up to date and sets sync to stamp every change; run once each time the database opens.
export function open_store(database: SqlDatabase): void {
  database.exec("PRAGMA foreign_keys = ON");
  // Each feature keeps its own schema version, so features grow apart without renumbering each other's steps.
  for (const feature of features) migrate(database, feature.migrations, { owner: feature.id });
  sync_engine.install(database);
}

// ── Calls ────────────────────────────────────────────────────────────────────

const all_methods = Object.assign({}, ...features.map((feature) => feature.methods)) as typeof settings_feature.methods & typeof budget_feature.methods;

type Bound<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (database: SqlDatabase, ...args: infer Args) => infer Result ? (...args: Args) => Result : never;
};

// Every call the page can make, as it makes them, without the database.
export type BudgetMethods = Bound<typeof all_methods>;

export const method_names = Object.keys(all_methods) as (keyof BudgetMethods & string)[];

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
      if (result instanceof Promise) return result.then((value: unknown) => (on_change(), value));
      on_change();
      return result;
    };
    return [name, call];
  });
  return Object.fromEntries(bound) as BudgetMethods;
}
