// What every host's backups share: their names, this device's schedule, and the calls the page makes on them.

// ── Imports ──────────────────────────────────────────────────────────────────

import { backup_naming, default_backup_schedule, type BackupMethods, type BackupSchedule, type Backups } from "@x-tech-laboratories/x-libs/backups";
import { read_setting, write_setting } from "@x-tech-laboratories/x-libs/settings";
import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";

import { backup_schedule_key } from "./settings.ts";

// ── Names ────────────────────────────────────────────────────────────────────

// Names such as budget-2026-06-10T09-30-00Z-auto.db.
export const budget_backup_naming = backup_naming("budget", ".db");

// ── Schedule ─────────────────────────────────────────────────────────────────

export function is_backup_schedule(value: unknown): value is BackupSchedule {
  const schedule = value as BackupSchedule | null;
  return typeof schedule?.automatic === "boolean" && Number.isInteger(schedule.to_keep) && schedule.to_keep >= 0;
}

// This device's schedule, kept in a settings row that never syncs.
export function read_backup_schedule(database: SqlDatabase): BackupSchedule {
  const stored = read_setting(database, backup_schedule_key);
  return is_backup_schedule(stored) ? stored : default_backup_schedule;
}

function write_backup_schedule(database: SqlDatabase, schedule: BackupSchedule): void {
  if (!is_backup_schedule(schedule)) throw new Error("A schedule needs automatic as true or false and a whole number to keep.");
  write_setting(database, backup_schedule_key, schedule);
}

// ── Calls ────────────────────────────────────────────────────────────────────

interface Restorable extends Backups {
  restore: (name: string) => Promise<void>;
}

// The page's backup calls on any host's backups; a new schedule is checked at once, such as to take a first daily backup.
export function backup_methods(kept: Restorable, database: () => SqlDatabase, check_schedule: () => void): BackupMethods {
  return {
    list_backups: kept.list,
    create_backup: () => kept.create(),
    restore_backup: kept.restore,
    remove_backup: kept.remove,
    get_backup_schedule: () => read_backup_schedule(database()),
    set_backup_schedule: (schedule) => {
      write_backup_schedule(database(), schedule);
      check_schedule();
    },
  };
}
