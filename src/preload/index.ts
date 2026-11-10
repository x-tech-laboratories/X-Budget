// Gives the desktop app's page its calls to the main process, under the names the page looks for.

// ── Imports ──────────────────────────────────────────────────────────────────

import { contextBridge, ipcRenderer } from "electron";

import { device_bridge, budget_bridge, budget_events } from "../shared/bridge.ts";

// ── Bridge ───────────────────────────────────────────────────────────────────

budget_bridge.expose(contextBridge, ipcRenderer, { envelopes: true });
device_bridge.expose(contextBridge, ipcRenderer, { envelopes: true });
budget_events.expose(contextBridge, ipcRenderer);
