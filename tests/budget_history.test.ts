import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { bind_methods, open_store, sync_engine } from "../src/shared/store.ts";

function open_methods() {
  const database = new DatabaseSync(":memory:");
  open_store(database);
  return { database, methods: bind_methods(() => database, () => undefined) };
}

describe("history", () => {
  it("keeps a version of a line for each change, newest first, with the one before", () => {
    const { methods } = open_methods();
    const rent = methods.add_budget_line("main", null);
    methods.update_budget_line(rent, { title: "Rent" });
    methods.update_budget_line(rent, { expense: 1200 });
    methods.update_budget_line(rent, { expense: 1200 });

    const versions = methods.list_line_versions(rent);
    expect(versions.map((version) => version.kind)).toEqual(["edited", "edited", "created"]);
    expect(versions[0]).toMatchObject({ item: "line", origin: "here", snapshot: { title: "Rent", expense: 1200 }, previous: { expense: 0 } });
  });

  it("restores an older version of a transaction as a new one", () => {
    const { methods } = open_methods();
    const lunch = methods.add_budget_transaction("main", "2026-08-02");
    methods.update_budget_transaction(lunch, { description: "Lunch", expense: 12 });
    methods.update_budget_transaction(lunch, { expense: 120 });

    const typo = methods.list_transaction_versions(lunch)[1]!;
    methods.restore_transaction_version(typo.id);
    expect(methods.list_budget_transactions("main", "2026-08")[0]!.expense).toBe(12);
    expect(methods.list_transaction_versions(lunch)[0]).toMatchObject({ kind: "restored", restored_from: typo.id });
  });

  it("brings a deleted line back with the lines deleted along with it", () => {
    const { methods } = open_methods();
    const housing = methods.add_budget_line("main", null);
    methods.update_budget_line(housing, { title: "Housing" });
    const rent = methods.add_budget_line("main", housing);
    methods.update_budget_line(rent, { title: "Rent", expense: 1200 });

    methods.delete_budget_line(housing);
    expect(methods.get_budget_plan("main").lines).toEqual([]);
    const deleted = methods.list_line_versions(housing)[0]!;
    expect(deleted.kind).toBe("deleted");

    methods.restore_line_version(deleted.id);
    const restored = methods.get_budget_plan("main").lines;
    expect(restored.map((line) => line.title).sort()).toEqual(["Housing", "Rent"]);
    expect(restored.find((line) => line.title === "Rent")!.parent_id).toBe(housing);
  });

  it("lists one budget's latest changes across lines and transactions", () => {
    const { methods } = open_methods();
    const other = methods.add_budget("Other");
    methods.add_budget_line(other, null);
    const line = methods.add_budget_line("main", null);
    const transaction = methods.add_budget_transaction("main", "2026-08-01");

    const changes = methods.list_budget_changes("main", 10);
    expect(changes.map((change) => [change.item, change.item_id]).sort()).toEqual([["line", line], ["transaction", transaction]].sort());
    expect(methods.list_budget_changes("main", 1)).toHaveLength(1);
  });

  it("syncs the versions, and leaves changes from elsewhere to the device that made them", () => {
    const { database, methods } = open_methods();
    const line = methods.add_budget_line("main", null);
    const changes = sync_engine.collect_changes_since(database, 0, "").changes;
    expect(changes.some((change) => change.table === "budget_line_versions")).toBe(true);

    const { database: other } = open_methods();
    sync_engine.apply_changes(other, changes.filter((change) => change.table === "budget_lines"));
    expect(other.prepare("SELECT COUNT(*) AS count FROM budget_line_versions_pending").get()).toEqual({ count: 0 });
    expect(bind_methods(() => other, () => undefined).list_line_versions(line)).toEqual([]);
  });

  it("prunes versions older than the days set, keeping each line's newest", () => {
    const { database, methods } = open_methods();
    const rent = methods.add_budget_line("main", null);
    methods.update_budget_line(rent, { title: "Rent" });
    database.prepare("UPDATE budget_line_versions SET changed_at = '2020-01-01T00:00:00.000Z'").run();
    methods.set_setting("history_days", 30);

    open_store(database);
    expect(methods.list_line_versions(rent)).toHaveLength(1);
  });
});
