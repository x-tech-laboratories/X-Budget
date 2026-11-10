import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { open_budget_database, type BudgetDatabase } from "../src/server/database.ts";
import { bind_methods, needs_upgrade, open_store, sync_engine } from "../src/shared/store.ts";

let opened: BudgetDatabase | null = null;

afterEach(() => {
  opened?.close();
  opened = null;
});

function open_in_temp(): { folder: string; budget: BudgetDatabase } {
  const folder = mkdtempSync(join(tmpdir(), "x-budget-db-"));
  opened = open_budget_database(join(folder, "budget.db"), join(folder, "backups"));
  return { folder, budget: opened };
}

describe("database backups", () => {
  it("takes a daily backup on opening and one by hand, newest first", async () => {
    const { budget } = open_in_temp();
    await vi.waitFor(async () => expect((await budget.backup_methods.list_backups()).some((backup) => backup.is_automatic)).toBe(true));
    await budget.backup_methods.create_backup();

    const listed = await budget.backup_methods.list_backups();
    expect(listed.some((backup) => backup.is_automatic)).toBe(true);
    expect(listed.some((backup) => !backup.is_automatic)).toBe(true);
    expect(listed.every((backup) => /^budget-.*\.db$/.test(backup.name))).toBe(true);
  });

  it("restores a backup, backing up the current data first, and keeps answering on the new connection", async () => {
    const { budget } = open_in_temp();
    const methods = bind_methods(budget.database, () => undefined);
    methods.rename_budget("main", "Before");
    const before = await budget.backup_methods.create_backup();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    methods.rename_budget("main", "After");

    await budget.backup_methods.restore_backup(before.name);
    expect(methods.list_budgets()[0]!.name).toBe("Before");
    expect((await budget.backup_methods.list_backups()).filter((backup) => !backup.is_automatic)).toHaveLength(2);
  });

  it("keeps the schedule on this device, out of what syncs", () => {
    const { budget } = open_in_temp();
    expect(budget.backup_methods.get_backup_schedule()).toEqual({ automatic: true, to_keep: 14 });

    budget.backup_methods.set_backup_schedule({ automatic: false, to_keep: 3 });
    expect(budget.backup_methods.get_backup_schedule()).toEqual({ automatic: false, to_keep: 3 });
    const changes = sync_engine.collect_changes_since(budget.database(), 0, "").changes;
    expect(changes.some((change) => change.table === "settings" && change.key === "backup_schedule")).toBe(false);
    expect(() => budget.backup_methods.set_backup_schedule({ automatic: true, to_keep: -1 })).toThrow("whole number");
  });

  it("tells a database with steps to run from a new or current one", () => {
    const database = new DatabaseSync(":memory:");
    expect(needs_upgrade(database)).toBe(false);
    open_store(database);
    expect(needs_upgrade(database)).toBe(false);
    database.prepare("UPDATE schema_versions SET version = 0 WHERE owner = 'budget'").run();
    expect(needs_upgrade(database)).toBe(true);
  });

  it("keeps backups in the folder beside the database", async () => {
    const { folder } = open_in_temp();
    await vi.waitFor(() => expect(readdirSync(join(folder, "backups")).length).toBeGreaterThan(0));
  });
});
