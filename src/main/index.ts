// The desktop app: its own database in the profile folder, the page's calls answered on it, and sync with a server when
// one is set, so it works offline and catches up once the server answers.

// ── Imports ──────────────────────────────────────────────────────────────────

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from "electron";
import { bring_to_front, hold_single_instance } from "@x-tech-laboratories/x-libs/electron/app";
import type { IpcMainEventLike } from "@x-tech-laboratories/x-libs/electron/bridge";
import { create_window, is_app_page } from "@x-tech-laboratories/x-libs/electron/window";
import { create_sync_client, type SyncConfig, type SyncStorage } from "@x-tech-laboratories/x-libs/sync_client";

import { device_bridge, budget_bridge, budget_events } from "../shared/bridge.ts";
import { bind_methods, open_store, sync_engine } from "../shared/store.ts";

// ── Profile ──────────────────────────────────────────────────────────────────

// Dev runs set this so they never touch the installed app's data.
if (process.env.X_BUDGET_USER_DATA) app.setPath("userData", join(process.cwd(), process.env.X_BUDGET_USER_DATA));

const profile = app.getPath("userData");
const backups_folder = join(profile, "backups");

// ── Database ─────────────────────────────────────────────────────────────────

mkdirSync(profile, { recursive: true });
const database = new DatabaseSync(join(profile, "budget.db"));
database.exec("PRAGMA journal_mode = WAL");
open_store(database);

function back_up(): void {
  mkdirSync(backups_folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  database.prepare("VACUUM INTO ?").run(join(backups_folder, `budget-${stamp}.db`));
}

function announce_change(): void {
  budget_events.emit(BrowserWindow.getAllWindows(), "changed", null);
}

// ── Sync ─────────────────────────────────────────────────────────────────────

const sync_file = join(profile, "sync.json");

// Only this user can read the file, since it holds the token.
const sync_storage: SyncStorage = {
  read_config: () => (existsSync(sync_file) ? (JSON.parse(readFileSync(sync_file, "utf8")) as SyncConfig) : null),
  write_config: (config) => {
    writeFileSync(sync_file, JSON.stringify(config, null, 2), { mode: 0o600 });
    chmodSync(sync_file, 0o600);
  },
  remove_config: () => rmSync(sync_file, { force: true }),
  back_up_before_download: back_up,
};

const sync = create_sync_client({
  engine: sync_engine,
  database: () => database,
  storage: sync_storage,
  data_name: "budget data",
  on_remote_change: announce_change,
  on_status: (status) => budget_events.emit(BrowserWindow.getAllWindows(), "sync_status", status),
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
    budget_bridge.handle(ipcMain, bind_methods(() => database, announce_change), { trusted, envelopes: true });
    device_bridge.handle(
      ipcMain,
      {
        get_sync_status: sync.get_status,
        connect_sync: sync.connect,
        disconnect_sync: sync.disconnect,
        sync_now: sync.sync_now,
      },
      { trusted, envelopes: true },
    );
    open_window();
    sync.start();
  });

  app.on("window-all-closed", () => {
    sync.stop();
    database.close();
    app.quit();
  });
}
