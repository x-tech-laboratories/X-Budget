// The calls the page makes and where they go: the desktop app's main process, which passes them to the chosen daemon,
// the web server, or the phone's own database. The page holds the same api on every host, so a view never asks where it runs.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_bridge, type Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { define_events } from "@x-tech-laboratories/x-libs/electron/events";
import { certificate_method_names, type CertificateClient, type CertificateMethods } from "@x-tech-laboratories/x-libs/certificate_protocol";
import { backup_method_names, type BackupClient, type BackupMethods } from "@x-tech-laboratories/x-libs/backups";
import { connection_method_names, type ConnectionClient, type ConnectionMethods } from "@x-tech-laboratories/x-libs/connection_protocol";
import { peer_listening_method_names, sync_device_method_names, type PeerListeningClient, type PeerListeningMethods, type SyncDeviceClient, type SyncDeviceMethods, type SyncStatus } from "@x-tech-laboratories/x-libs/sync_protocol";

import { desktop_method_names, type DesktopMethods } from "./desktop.ts";
import { method_names, type BudgetMethods } from "./store.ts";

// ── Data calls ───────────────────────────────────────────────────────────────

export const budget_bridge = define_bridge<BudgetMethods>("x_budget", method_names);

// ── Device calls ─────────────────────────────────────────────────────────────

// Sync with the paired devices: this device's own, or in a browser the server's, which only an admin reaches.
export const device_bridge = define_bridge<SyncDeviceMethods>("x_budget_device", sync_device_method_names);

// Whether other devices may reach this computer's sync, and on which port.
export const peer_listening_bridge = define_bridge<PeerListeningMethods>("x_budget_peer_listening", peer_listening_method_names);

// Backups of this device's data, or in a browser, of the server's, which only an admin reaches.
export const backup_bridge = define_bridge<BackupMethods>("x_budget_backups", backup_method_names);

// Server certificates the user chose to trust, such as a home sync server's self-signed one.
export const certificate_bridge = define_bridge<CertificateMethods>("x_budget_certificates", certificate_method_names);

// The desktop app's own settings and quitting it completely.
export const desktop_bridge = define_bridge<DesktopMethods>("x_budget_desktop", desktop_method_names);

// The daemons the desktop app can work on: this computer's, or a server signed in to as this device.
export const connection_bridge = define_bridge<ConnectionMethods>("x_budget_connections", connection_method_names);

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
  // The sync of the copy the page works on; null in a desktop window working on a server's daemon.
  device: SyncDeviceClient | null;
  // Null where backups cannot be kept yet.
  backups: BackupClient | null;
  // Set on a phone, whose backups go in a folder the user picks.
  backup_folder?: BackupFolder;
  // Set where the app makes its own connections and can trust a certificate the system refuses.
  certificates?: CertificateClient;
  // Set in the desktop app: the daemons it can work on, and its own settings.
  connections?: ConnectionClient;
  // Set on the desktop while it works on this computer's daemon, which other devices may be let reach.
  peer_listening?: PeerListeningClient;
  desktop?: Client<DesktopMethods>;
  // Runs whenever the data changed somewhere else; returns the function that stops listening.
  on_change: (listener: () => void) => () => void;
}
