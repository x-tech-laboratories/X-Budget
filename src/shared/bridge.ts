// The calls the page makes and where they go: the desktop app's main process, the web server, or the phone's own
// database. The page holds the same api on every host, so a view never asks where it runs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_bridge, type Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { define_events } from "@x-tech-laboratories/x-libs/electron/events";
import type { SyncDirection, SyncStatus } from "@x-tech-laboratories/x-libs/sync_protocol";

import { method_names, type BudgetMethods } from "./store.ts";

// ── Data calls ───────────────────────────────────────────────────────────────

export const budget_bridge = define_bridge<BudgetMethods>("x_budget", method_names);

// ── Device calls ─────────────────────────────────────────────────────────────

// Sync with a server, which only a device with its own database does; a browser is already on the server.
export interface DeviceMethods {
  get_sync_status: () => SyncStatus;
  connect_sync: (server_url: string, token: string, direction: SyncDirection) => Promise<SyncStatus>;
  disconnect_sync: () => SyncStatus;
  sync_now: () => Promise<SyncStatus>;
}

export const device_method_names = ["get_sync_status", "connect_sync", "disconnect_sync", "sync_now"] as const satisfies readonly (keyof DeviceMethods)[];

export const device_bridge = define_bridge<DeviceMethods>("x_budget_device", device_method_names);

// What the main process tells the page on its own: the data changed elsewhere, or sync's status moved.
export type BudgetEvents = { changed: null; sync_status: SyncStatus };

export const budget_events = define_events<BudgetEvents>("x_budget_events");

// ── The page's api ───────────────────────────────────────────────────────────

export type Host = "web" | "desktop" | "android";

export interface PageApi {
  host: Host;
  calls: Client<BudgetMethods>;
  // Null in a browser, which syncs nothing itself.
  device: Client<DeviceMethods> | null;
  // Runs whenever the data changed somewhere else; returns the function that stops listening.
  on_change: (listener: () => void) => () => void;
}
