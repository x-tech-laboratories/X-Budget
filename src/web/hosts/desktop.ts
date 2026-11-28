// The desktop app's page: the preload has put the main process's calls on the window, which go to this computer's
// daemon or to the X-Budget server that Settings → Connections chose.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import type { EventsClient } from "@x-tech-laboratories/x-libs/electron/events";
import type { BackupClient } from "@x-tech-laboratories/x-libs/backups";
import type { CertificateClient } from "@x-tech-laboratories/x-libs/certificate_protocol";
import { LOCAL_CONNECTION_ID, type ConnectionClient } from "@x-tech-laboratories/x-libs/connection_protocol";
import type { PeerListeningClient, SyncDeviceClient } from "@x-tech-laboratories/x-libs/sync_protocol";

import { backup_bridge, budget_bridge, certificate_bridge, budget_events, connection_bridge, desktop_bridge, device_bridge, peer_listening_bridge, type BudgetEvents, type PageApi } from "../../shared/bridge.ts";
import type { DesktopMethods } from "../../shared/desktop.ts";
import type { BudgetMethods } from "../../shared/store.ts";

// ── Api ──────────────────────────────────────────────────────────────────────

type DesktopWindow = Record<string, unknown>;

export function is_desktop(): boolean {
  return budget_bridge.api_name in window;
}

// The window starts again whenever another daemon is chosen, so where it runs is read once here.
export async function desktop_api(): Promise<PageApi> {
  const desktop = window as unknown as DesktopWindow;
  const events = desktop[budget_events.api_name] as EventsClient<BudgetEvents>;
  const connections = desktop[connection_bridge.api_name] as ConnectionClient;
  const is_here = (await connections.list_connections()).current === LOCAL_CONNECTION_ID;
  return {
    host: "desktop",
    calls: desktop[budget_bridge.api_name] as Client<BudgetMethods>,
    // Sync belongs to this computer's own daemon, so it shows only while that daemon is in use.
    device: is_here ? (desktop[device_bridge.api_name] as SyncDeviceClient) : null,
    ...(is_here ? { peer_listening: desktop[peer_listening_bridge.api_name] as PeerListeningClient } : {}),
    backups: desktop[backup_bridge.api_name] as BackupClient,
    certificates: desktop[certificate_bridge.api_name] as CertificateClient,
    connections,
    desktop: desktop[desktop_bridge.api_name] as Client<DesktopMethods>,
    on_change: (listener) => events.on("changed", listener),
  };
}
