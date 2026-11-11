// What each part of X-Budget, such as the budget, brings to the one database every device keeps: its tables,
// which of them sync, and the calls the page makes on them.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";
import type { ApiSpec } from "@x-tech-laboratories/x-libs/api_spec";
import type { History } from "@x-tech-laboratories/x-libs/history";
import type { SyncedTable } from "@x-tech-laboratories/x-libs/sync_engine";

// ── Features ─────────────────────────────────────────────────────────────────

// The parts of an X-Libs history the store runs, whatever the items are.
export type KeptHistory = Pick<History<unknown>, "synced_table" | "install" | "forget_touched" | "record" | "prune">;

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
  // What each call does and takes, for programs that reach them through MCP or the API.
  api: ApiSpec<Methods>;
  // Settings this feature reads, by key such as "budget.currency", with their defaults.
  setting_defaults?: Record<string, unknown>;
  // The versions kept of the feature's items, recorded after every write and synced with them.
  histories?: KeptHistory[];
}

export function define_feature<Methods extends Record<string, StoreMethod>>(feature: Feature<Methods>): Feature<Methods> {
  return feature;
}

// A new id that every device can make on its own without clashing.
export function new_id(): string {
  return crypto.randomUUID();
}
