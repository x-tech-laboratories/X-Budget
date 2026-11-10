// The desktop app's page: the preload has put the main process's calls on the window.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import type { EventsClient } from "@x-tech-laboratories/x-libs/electron/events";
import type { SyncDeviceClient } from "@x-tech-laboratories/x-libs/sync_protocol";

import { device_bridge, budget_bridge, budget_events, type BudgetEvents, type PageApi } from "../../shared/bridge.ts";
import type { BudgetMethods } from "../../shared/store.ts";

// ── Api ──────────────────────────────────────────────────────────────────────

type DesktopWindow = Record<string, unknown>;

export function is_desktop(): boolean {
  return budget_bridge.api_name in window;
}

export function desktop_api(): PageApi {
  const desktop = window as unknown as DesktopWindow;
  const events = desktop[budget_events.api_name] as EventsClient<BudgetEvents>;
  return {
    host: "desktop",
    calls: desktop[budget_bridge.api_name] as Client<BudgetMethods>,
    device: desktop[device_bridge.api_name] as SyncDeviceClient,
    on_change: (listener) => events.on("changed", listener),
  };
}
