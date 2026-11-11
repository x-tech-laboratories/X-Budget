// The budget database as the server and the desktop app keep it: a file opened and brought up to date, backed up before
// its schema is upgraded, before a device's or the server's copy replaces it, and daily, and restored from a backup.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { keep_backing_up, type BackupMethods } from "@x-tech-laboratories/x-libs/backups";
import { sqlite_backups } from "@x-tech-laboratories/x-libs/server/sqlite_backups";

import { backup_methods, budget_backup_naming, read_backup_schedule } from "../shared/backups.ts";
import { needs_upgrade, open_store, sync_engine } from "../shared/store.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface BudgetDatabase {
  // The open connection, which a restore replaces.
  database: () => DatabaseSync;
  // A backup made by hand, such as before a device's data replaces this one.
  back_up: () => Promise<void>;
  backup_methods: BackupMethods;
  close: () => void;
}

// ── Database ─────────────────────────────────────────────────────────────────

export function open_budget_database(path: string, backups_folder: string): BudgetDatabase {
  mkdirSync(dirname(path), { recursive: true });
  const existed = existsSync(path);
  let database = new DatabaseSync(path);

  const kept = sqlite_backups({
    folder: () => (mkdirSync(backups_folder, { recursive: true }), backups_folder),
    naming: budget_backup_naming,
    database: () => database,
    database_path: () => path,
    close: () => database.close(),
    open: () => {
      database = new DatabaseSync(path);
      start(database);
    },
    // The restored data no longer matches other devices', so sync asks again which copy wins.
    after_restore: (restored) => sync_engine.forget_history(restored),
  });

  // An upgrade is backed up first, since it cannot be undone any other way.
  function start(connection: DatabaseSync): void {
    connection.exec("PRAGMA journal_mode = WAL");
    if (existed && needs_upgrade(connection)) connection.prepare("VACUUM INTO ?").run(join(backups_folder, budget_backup_naming.name_for(new Date(), false)));
    open_store(connection);
  }
  mkdirSync(backups_folder, { recursive: true });
  start(database);

  const keeper = keep_backing_up(kept, () => read_backup_schedule(database));

  return {
    database: () => database,
    back_up: async () => void (await kept.create()),
    backup_methods: backup_methods(kept, () => database, () => void keeper.check()),
    close: () => {
      keeper.stop();
      database.close();
    },
  };
}
