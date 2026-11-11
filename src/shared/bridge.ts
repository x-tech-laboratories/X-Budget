// The calls the page makes and where they go: the desktop app's main process, the web server, or the phone's own
// database. The page holds the same api on every host, so a view never asks where it runs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_bridge, type Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { define_events } from "@x-tech-laboratories/x-libs/electron/events";
import { certificate_method_names, type CertificateClient, type CertificateMethods } from "@x-tech-laboratories/x-libs/certificate_protocol";
import { backup_method_names, type BackupClient, type BackupMethods } from "@x-tech-laboratories/x-libs/backups";
import { sync_device_method_names, type SyncDeviceClient, type SyncDeviceMethods, type SyncStatus } from "@x-tech-laboratories/x-libs/sync_protocol";

import { method_names, type BudgetMethods } from "./store.ts";

// ── Data calls ───────────────────────────────────────────────────────────────

export const budget_bridge = define_bridge<BudgetMethods>("x_budget", method_names);

// ── Device calls ─────────────────────────────────────────────────────────────

// Sync with a server, which only a device with its own database does; a browser is already on the server.
export const device_bridge = define_bridge<SyncDeviceMethods>("x_budget_device", sync_device_method_names);

// Backups of this device's data, or in a browser, of the server's, which only an admin reaches.
export const backup_bridge = define_bridge<BackupMethods>("x_budget_backups", backup_method_names);

// Server certificates the user chose to trust, such as a home sync server's self-signed one.
export const certificate_bridge = define_bridge<CertificateMethods>("x_budget_certificates", certificate_method_names);

// What the main process tells the page on its own: the data changed elsewhere, or sync's status moved.
export type BudgetEvents = { changed: null; sync_status: SyncStatus };

export const budget_events = define_events<BudgetEvents>("x_budget_events");

// ── The page's api ───────────────────────────────────────────────────────────

export type Host = "web" | "desktop" | "android";

// The folder a phone keeps its backups in; its name is "" until one is picked.
export interface BackupFolder {
  name: () => Promise<string>;
  choose: () => Promise<string>;
}

export interface PageApi {
  host: Host;
  calls: Client<BudgetMethods>;
  // Null in a browser, which syncs nothing itself.
  device: SyncDeviceClient | null;
  // Null where backups cannot be kept yet.
  backups: BackupClient | null;
  // Set on a phone, whose backups go in a folder the user picks.
  backup_folder?: BackupFolder;
  // Set where the app makes its own connections and can trust a certificate the system refuses.
  certificates?: CertificateClient;
  // Runs whenever the data changed somewhere else; returns the function that stops listening.
  on_change: (listener: () => void) => () => void;
}
