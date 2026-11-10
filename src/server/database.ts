// The budget database as the server and the desktop app keep it: a file opened and brought up to date, backed up before
// its schema is upgraded, before a device's or the server's copy replaces it, and daily, and restored from a backup.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { backup_naming, default_backup_schedule, keep_backing_up, type BackupMethods, type BackupSchedule } from "@x-tech-laboratories/x-libs/backups";
import { sqlite_backups } from "@x-tech-laboratories/x-libs/server/sqlite_backups";

import { backup_schedule_key, read_setting } from "../shared/settings.ts";
import { needs_upgrade, open_store, sync_engine } from "../shared/store.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export const budget_backup_naming = backup_naming("budget", ".db");

export interface BudgetDatabase {
  // The open connection, which a restore replaces.
  database: () => DatabaseSync;
  // A backup made by hand, such as before a device's data replaces this one.
  back_up: () => Promise<void>;
  backup_methods: BackupMethods;
  close: () => void;
}

// ── Schedule ─────────────────────────────────────────────────────────────────

function is_schedule(value: unknown): value is BackupSchedule {
  const schedule = value as BackupSchedule | null;
  return typeof schedule?.automatic === "boolean" && Number.isInteger(schedule.to_keep) && schedule.to_keep >= 0;
}

function read_schedule(database: DatabaseSync): BackupSchedule {
  const stored = read_setting(database, backup_schedule_key, default_backup_schedule);
  return is_schedule(stored) ? stored : default_backup_schedule;
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

  const keeper = keep_backing_up(kept, () => read_schedule(database));

  const backup_methods: BackupMethods = {
    list_backups: kept.list,
    create_backup: () => kept.create(),
    restore_backup: kept.restore,
    remove_backup: kept.remove,
    get_backup_schedule: () => read_schedule(database),
    set_backup_schedule: (schedule) => {
      if (!is_schedule(schedule)) throw new Error("A schedule needs automatic as true or false and a whole number to keep.");
      database.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(backup_schedule_key, JSON.stringify(schedule));
      void keeper.check();
    },
  };

  return {
    database: () => database,
    back_up: async () => void (await kept.create()),
    backup_methods,
    close: () => {
      keeper.stop();
      database.close();
    },
  };
}
