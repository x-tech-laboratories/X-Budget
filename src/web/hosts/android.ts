// The phone's page: it keeps its own database, answers its calls on it, and syncs with a server when one is set.

// ── Imports ──────────────────────────────────────────────────────────────────

import { App } from "@capacitor/app";
import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { keep_backing_up } from "@x-tech-laboratories/x-libs/backups";
import { phone_backups } from "@x-tech-laboratories/x-libs/phone_backups";
import { phone_certificates } from "@x-tech-laboratories/x-libs/phone_certificates";
import { create_sync_client, sync_device_methods } from "@x-tech-laboratories/x-libs/sync_client";
import { indexed_db_files, open_wasm_database } from "@x-tech-laboratories/x-libs/web/sqlite_wasm";
import { local_sync_storage } from "@x-tech-laboratories/x-libs/web/sync_storage";

import type { PageApi } from "../../shared/bridge.ts";
import { backup_methods, budget_backup_naming, read_backup_schedule } from "../../shared/backups.ts";
import { bind_methods, needs_upgrade, open_store, sync_engine, type BudgetMethods } from "../../shared/store.ts";

// ── Files ────────────────────────────────────────────────────────────────────

const files = indexed_db_files("x-budget");
const database_file = "budget.db";
const before_sync_file = "budget-before-sync.db";
const sync_config_key = "x-budget-sync";

// ── Api ──────────────────────────────────────────────────────────────────────

// Each call runs straight on the database in this page; answers are promises, as they are on the other hosts.
function as_client<Methods extends { [Name in keyof Methods]: (...args: never[]) => unknown }>(methods: Methods): Client<Methods> {
  const entries = Object.entries(methods as Record<string, (...args: never[]) => unknown>).map(([name, method]) => [name, async (...args: never[]) => method(...args)]);
  return Object.fromEntries(entries) as Client<Methods>;
}

export async function android_api(): Promise<PageApi> {
  const database = await open_wasm_database({ files, file_name: database_file });

  // Backups go in a folder the user picks; a restored copy is brought up to date and sync asks again which copy wins.
  const kept = phone_backups({
    naming: budget_backup_naming,
    database,
    after_restore: (restored) => {
      open_store(restored);
      sync_engine.forget_history(restored);
    },
  });
  const has_folder = async () => (await kept.folder_name()) !== "";

  // An upgrade is backed up first when there is a folder, since it cannot be undone any other way.
  if (needs_upgrade(database.connection) && (await has_folder())) await kept.create();
  open_store(database.connection);
  await database.save_now();
  const keeper = keep_backing_up(kept, () => read_backup_schedule(database.connection));

  const listeners = new Set<() => void>();
  const announce = (): void => {
    for (const listener of listeners) listener();
  };

  // The server and token stay in the app's private storage; before a download the data is backed up to the folder, or
  // beside the database while there is none.
  const back_up_before_download = async () => ((await has_folder()) ? void (await kept.create()) : files.write(before_sync_file, database.export_bytes()));
  const storage = local_sync_storage({ key: sync_config_key, back_up_before_download });
  const sync = create_sync_client({ engine: sync_engine, database: () => database.connection, storage, data_name: "budget data", on_remote_change: announce });

  // A phone may close the app at any moment once it is in the background, so the database is saved straight away.
  void App.addListener("pause", () => void database.save_now());
  void App.addListener("resume", () => void sync.sync_now());
  sync.start();

  const methods: BudgetMethods = bind_methods(() => database.connection, () => undefined);
  return {
    host: "android",
    calls: as_client(methods),
    device: as_client(sync_device_methods(sync)),
    certificates: phone_certificates(),
    backups: as_client(backup_methods(kept, () => database.connection, () => void keeper.check())),
    backup_folder: {
      name: kept.folder_name,
      // A first daily backup is taken as soon as a folder is picked.
      choose: async () => {
        const name = await kept.choose_folder();
        await keeper.check();
        return name;
      },
    },
    on_change: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
