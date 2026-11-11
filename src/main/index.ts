// The desktop app: its own database in the profile folder, the page's calls answered on it, and sync with a server when
// one is set, so it works offline and catches up once the server answers.

// ── Imports ──────────────────────────────────────────────────────────────────

import { join } from "node:path";

import { app, BrowserWindow, ipcMain, nativeTheme, screen, session, shell } from "electron";
import { bring_to_front, hold_single_instance } from "@x-tech-laboratories/x-libs/electron/app";
import type { IpcMainEventLike } from "@x-tech-laboratories/x-libs/electron/bridge";
import { trust_in_session, trusting_fetch } from "@x-tech-laboratories/x-libs/electron/certificates";
import { create_window, is_app_page } from "@x-tech-laboratories/x-libs/electron/window";
import { create_sync_client, sync_device_methods } from "@x-tech-laboratories/x-libs/sync_client";
import { create_certificate_trust } from "@x-tech-laboratories/x-libs/certificates";
import { file_sync_storage } from "@x-tech-laboratories/x-libs/sync_file_storage";

import { open_budget_database } from "../server/database.ts";
import { backup_bridge, budget_bridge, certificate_bridge, budget_events, device_bridge } from "../shared/bridge.ts";
import { bind_methods, sync_engine } from "../shared/store.ts";

// ── Profile ──────────────────────────────────────────────────────────────────

// Dev runs set this so they never touch the installed app's data.
if (process.env.X_BUDGET_USER_DATA) app.setPath("userData", join(process.cwd(), process.env.X_BUDGET_USER_DATA));

const profile = app.getPath("userData");
const backups_folder = join(profile, "backups");

// ── Database ─────────────────────────────────────────────────────────────────

// Backed up before an upgrade, before the server's copy replaces it, and daily, beside the database.
const budget = open_budget_database(join(profile, "budget.db"), backups_folder);

function announce_change(): void {
  budget_events.emit(BrowserWindow.getAllWindows(), "changed", null);
}

// ── Sync ─────────────────────────────────────────────────────────────────────

// Server certificates the user trusted, such as a home server's self-signed one, kept beside the database.
const certificates = create_certificate_trust({ file: join(profile, "trusted-certificates.json") });

const sync = create_sync_client({
  engine: sync_engine,
  database: budget.database,
  storage: file_sync_storage({ file: join(profile, "sync.json"), back_up_before_download: budget.back_up }),
  data_name: "budget data",
  on_remote_change: announce_change,
  on_status: (status) => budget_events.emit(BrowserWindow.getAllWindows(), "sync_status", status),
  // Chromium's network stack honours the trusted certificates, which Node's own fetch would not.
  fetch: trusting_fetch(session, certificates),
});

// ── Window ───────────────────────────────────────────────────────────────────

const page = {
  dev_url: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
  file: join(import.meta.dirname, "../renderer/index.html"),
};

function open_window(): BrowserWindow {
  return create_window(BrowserWindow, {
    ...page,
    title: "X-Budget",
    icon: join(import.meta.dirname, "../../resources/icon.png"),
    // electron-vite emits an ESM preload as .mjs; loading .js here silently yields no bridge.
    preload: join(import.meta.dirname, "../preload/index.mjs"),
    default_size: { width: 1100, height: 760 },
    min_size: { width: 360, height: 480 },
    native_theme: nativeTheme,
    shell,
    screen,
    state_file: join(profile, "window.json"),
  });
}

// ── Start ────────────────────────────────────────────────────────────────────

// Only the app's own page may call in, never a site a link led to.
function trusted(event: IpcMainEventLike): boolean {
  return is_app_page(event.senderFrame?.url ?? "", page);
}

function show_existing_window(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (window) bring_to_front(window);
}

if (hold_single_instance(app, show_existing_window)) {
  void app.whenReady().then(() => {
    budget_bridge.handle(ipcMain, bind_methods(budget.database, announce_change), { trusted, envelopes: true });
    backup_bridge.handle(ipcMain, budget.backup_methods, { trusted, envelopes: true });
    device_bridge.handle(ipcMain, sync_device_methods(sync), { trusted, envelopes: true });
    certificate_bridge.handle(ipcMain, certificates.methods, { trusted, envelopes: true });
    trust_in_session(session.defaultSession, certificates.is_trusted);
    open_window();
    sync.start();
  });

  app.on("window-all-closed", () => {
    sync.stop();
    budget.close();
    app.quit();
  });
}
