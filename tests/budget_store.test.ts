import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { bind_methods, open_store } from "../src/shared/store.ts";

function open_methods() {
  const database = new DatabaseSync(":memory:");
  open_store(database);
  return bind_methods(() => database, () => undefined);
}

describe("budgets", () => {
  it("starts with one budget every device shares, and adds, renames and deletes others", () => {
    const methods = open_methods();
    expect(methods.list_budgets()).toEqual([{ id: "main", name: "Budget", position: 0, lines: 0, transactions: 0 }]);

    const id = methods.add_budget("  Holiday ");
    methods.rename_budget(id, "Trip");
    methods.add_budget_line(id, null);
    methods.add_budget_transaction(id, "2026-08-01");
    expect(methods.list_budgets().map((budget) => [budget.name, budget.lines, budget.transactions])).toEqual([["Budget", 0, 0], ["Trip", 1, 1]]);

    expect(methods.delete_budget(id)).toEqual({ lines: 1, transactions: 1 });
    expect(methods.list_budgets()).toHaveLength(1);
  });
});

describe("lines", () => {
  it("adds lines last among their siblings and keeps amounts to the places set", () => {
    const methods = open_methods();
    const housing = methods.add_budget_line("main", null);
    const rent = methods.add_budget_line("main", housing);
    const power = methods.add_budget_line("main", housing);
    methods.update_budget_line(housing, { title: "Housing", expense: 9999 });
    methods.update_budget_line(rent, { title: "Rent", expense: 1200.004 });
    methods.update_budget_line(power, { title: "Power", expense: 99.995, notes: "due the 20th" });

    const plan = methods.get_budget_plan("main");
    expect(plan.mode).toBe("computed");
    expect(plan.lines.find((line) => line.id === power)).toMatchObject({ position: 1, expense: 100, notes: "due the 20th" });
    expect(plan.totals[housing]).toMatchObject({ expense: 1300 });
    expect(plan.total).toEqual({ income: 0, expense: 1300, balance: -1300 });

    methods.set_setting("decimals", 0);
    methods.update_budget_line(rent, { expense: 1200.5 });
    expect(methods.get_budget_plan("main").lines.find((line) => line.id === rent)!.expense).toBe(1201);
  });

  it("follows the parent rule chosen in settings", () => {
    const methods = open_methods();
    const housing = methods.add_budget_line("main", null);
    methods.update_budget_line(methods.add_budget_line("main", housing), { expense: 1300 });
    methods.update_budget_line(housing, { expense: 1250 });
    methods.set_setting("budget.rollup_mode", "cap");

    expect(methods.get_budget_plan("main").totals[housing]).toMatchObject({ expense: 1250, over: true });
  });

  it("moves a line anywhere in its budget but inside itself", () => {
    const methods = open_methods();
    const first = methods.add_budget_line("main", null);
    const child = methods.add_budget_line("main", first);
    const second = methods.add_budget_line("main", null);

    methods.move_budget_line(first, second, 0);
    expect(methods.get_budget_plan("main").lines.find((line) => line.id === first)!.parent_id).toBe(second);
    expect(() => methods.move_budget_line(second, child, 0)).toThrow("inside itself");
    const other = methods.add_budget("Other");
    expect(() => methods.move_budget_line(first, methods.add_budget_line(other, null), 0)).toThrow("another budget");
  });

  it("deletes a line with everything under it and leaves its transactions unbudgeted", () => {
    const methods = open_methods();
    const housing = methods.add_budget_line("main", null);
    const rent = methods.add_budget_line("main", housing);
    const transaction = methods.add_budget_transaction("main", "2026-08-01");
    methods.update_budget_transaction(transaction, { expense: 1200, line_id: rent });

    expect(methods.delete_budget_line(housing)).toBe(2);
    expect(methods.get_budget_plan("main").lines).toEqual([]);
    expect(methods.get_budget_report("main", "2026-08").unbudgeted.expense).toBe(1200);
  });
});

describe("transactions", () => {
  it("lists one month by day and never takes a date that is not a day", () => {
    const methods = open_methods();
    const late = methods.add_budget_transaction("main", "2026-08-31");
    const early = methods.add_budget_transaction("main", "2026-08-01");
    methods.add_budget_transaction("main", "2026-09-01");
    methods.update_budget_transaction(late, { date: "", description: "Groceries", expense: 54.321 });
    methods.update_budget_transaction(early, { line_id: "" });

    const august = methods.list_budget_transactions("main", "2026-08");
    expect(august.map((transaction) => transaction.id)).toEqual([early, late]);
    expect(august[1]).toMatchObject({ date: "2026-08-31", description: "Groceries", expense: 54.32 });
    expect(august[0]!.line_id).toBeNull();
    expect(() => methods.add_budget_transaction("main", "2026-02-30")).toThrow("Not a day");
    expect(() => methods.list_budget_transactions("main", "August")).toThrow("Not a month");

    methods.delete_budget_transaction(late);
    expect(methods.list_budget_transactions("main", "2026-08")).toHaveLength(1);
  });
});

describe("report", () => {
  it("measures the month and gives as many trend months as set", () => {
    const methods = open_methods();
    const food = methods.add_budget_line("main", null);
    methods.update_budget_line(food, { title: "Food", expense: 400 });
    const lunch = methods.add_budget_transaction("main", "2026-08-02");
    methods.update_budget_transaction(lunch, { expense: 450, line_id: food });
    methods.set_setting("budget.trend_months", 3);

    const report = methods.get_budget_report("main", "2026-08");
    expect(report).toMatchObject({ spent: 450, on_budget_expense: 400, off_budget_expense: 50, mode: "computed" });
    expect(report.trend.map((month) => month.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("import and export", () => {
  it("reads a Trilium budget into a new budget, with old single amounts as expenses and transactions on their rows", () => {
    const methods = open_methods();
    const file = JSON.stringify({
      rows: [{ id: "a", title: "Housing", children: [{ id: "b", title: "Rent", amount: 1200 }] }, { id: "c", title: "Pay", income: 3000 }],
      transactions: [
        { id: "t1", date: "2026-08-01", description: "Rent", expense: 1200, rowId: "b" },
        { id: "t2", date: "2026-08-03", description: "Concert", expense: 85, rowId: null },
        { id: "t3", date: "", description: "Lost", expense: 1, rowId: null },
      ],
    });

    const imported = methods.import_budget("Household", file);
    expect(imported).toMatchObject({ lines: 3, transactions: 2, skipped: 1 });
    const plan = methods.get_budget_plan(imported.id);
    const rent = plan.lines.find((line) => line.title === "Rent")!;
    expect(rent).toMatchObject({ expense: 1200, income: 0 });
    expect(plan.lines.find((line) => line.id === rent.parent_id)!.title).toBe("Housing");
    expect(methods.list_budget_transactions(imported.id, "2026-08").find((transaction) => transaction.description === "Rent")!.line_id).toBe(rent.id);
  });

  it("writes the add-on's shape and reads it back alike, and refuses what is not a budget", () => {
    const methods = open_methods();
    const housing = methods.add_budget_line("main", null);
    methods.update_budget_line(housing, { title: "Housing" });
    const rent = methods.add_budget_line("main", housing);
    methods.update_budget_line(rent, { title: "Rent", expense: 1200 });
    methods.update_budget_transaction(methods.add_budget_transaction("main", "2026-08-01"), { expense: 1200, line_id: rent });

    const exported = JSON.parse(methods.export_budget("main"));
    expect(exported.rows[0]).toMatchObject({ title: "Housing", children: [{ title: "Rent", expense: 1200, children: [] }] });
    expect(exported.transactions[0]).toMatchObject({ date: "2026-08-01", expense: 1200, rowId: rent });

    const copy = methods.import_budget("Copy", JSON.stringify(exported));
    expect(methods.get_budget_report(copy.id, "2026-08")).toMatchObject({ on_budget_expense: 1200, off_budget_expense: 0 });
    expect(() => methods.import_budget("Bad", "{ nope")).toThrow("not valid JSON");
    expect(() => methods.import_budget("Bad", '{"rows": 5}')).toThrow('"rows" list');
    expect(methods.import_budget("Rows", '[{"title": "Solo", "expense": 5}]')).toMatchObject({ lines: 1, transactions: 0 });
    expect(methods.list_budgets()).toHaveLength(3);
  });
});
