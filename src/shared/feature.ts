// What each part of X-Budget, such as the budget, brings to the one database every device keeps: its tables,
// which of them sync, and the calls the page makes on them.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";
import type { SyncedTable } from "@x-tech-laboratories/x-libs/sync_engine";

// ── Features ─────────────────────────────────────────────────────────────────

// A call runs where the database is: on the server, in the desktop app's main process, or in the phone's page.
export type StoreMethod = (database: SqlDatabase, ...args: never[]) => unknown;

export interface Feature<Methods extends Record<string, StoreMethod>> {
  id: string;
  // Each step runs once, in order; a released step is never edited, only followed by a new one.
  migrations: string[];
  // Parents before children; every table the page writes syncs unless it is only this device's.
  tables: SyncedTable[];
  // Names that read start with list_, get_, search_, lookup_ or export_, so a write is the only call that announces a change.
  methods: Methods;
  // Settings this feature reads, by key such as "budget.currency", with their defaults.
  setting_defaults?: Record<string, unknown>;
}

export function define_feature<Methods extends Record<string, StoreMethod>>(feature: Feature<Methods>): Feature<Methods> {
  return feature;
}

// A new id that every device can make on its own without clashing.
export function new_id(): string {
  return crypto.randomUUID();
}
