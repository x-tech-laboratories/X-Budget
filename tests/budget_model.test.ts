import { describe, expect, it } from "vitest";

import { compute_totals, grand_totals, line_paths, line_tree, monthly_report, monthly_trend, parent_ids, type BudgetLine, type BudgetTransaction } from "../src/shared/budget/model.ts";

function line(id: string, parent_id: string | null, position: number, title: string, income: number, expense: number): BudgetLine {
  return { id, budget_id: "main", parent_id, position, title, income, expense, notes: "" };
}

function spent(id: string, date: string, expense: number, line_id: string | null, income = 0): BudgetTransaction {
  return { id, budget_id: "main", date, description: id, income, expense, line_id };
}

// Housing holds Rent and Power; Salary stands alone.
const lines = [
  line("power", "housing", 1, "Power", 0, 100),
  line("housing", null, 0, "Housing", 0, 1250),
  line("rent", "housing", 0, "Rent", 0, 1200),
  line("salary", null, 1, "Salary", 3000, 0),
];

const august = [
  spent("rent", "2026-08-01", 1200, "rent"),
  spent("power", "2026-08-20", 150, "power"),
  spent("concert", "2026-08-03", 85, null),
  spent("salary", "2026-08-31", 0, "salary", 2800),
  spent("july", "2026-07-31", 40, "power"),
];

describe("budget lines", () => {
  it("nests lines by position and names each by its whole path", () => {
    const nodes = line_tree(lines);
    expect(nodes.map((node) => node.item.id)).toEqual(["housing", "salary"]);
    expect(nodes[0]!.children.map((node) => node.item.id)).toEqual(["rent", "power"]);
    expect(line_paths(nodes).get("power")).toBe("Housing / Power");
    expect(parent_ids(nodes)).toEqual(["housing"]);
  });

  it("puts a line whose parent is gone at the top", () => {
    expect(line_tree([line("orphan", "deleted", 0, "", 0, 5)]).map((node) => node.item.id)).toEqual(["orphan"]);
  });
});

describe("totals", () => {
  it("makes a parent the sum of its children when computed", () => {
    const nodes = line_tree(lines);
    const totals = compute_totals(nodes, "computed");
    expect(totals.get("housing")).toMatchObject({ expense: 1300, balance: -1300, is_leaf: false, over: false });
    expect(grand_totals(nodes, totals)).toEqual({ income: 3000, expense: 1300, balance: 1700 });
  });

  it("adds a parent's own amounts to its children's", () => {
    expect(compute_totals(line_tree(lines), "additive").get("housing")).toMatchObject({ expense: 2550, children_expense: 1300 });
  });

  it("keeps a cap as typed and marks it over when its children spend past it", () => {
    const totals = compute_totals(line_tree(lines), "cap");
    expect(totals.get("housing")).toMatchObject({ expense: 1250, children_expense: 1300, over: true });
    expect(compute_totals(line_tree(lines), "computed").get("housing")!.over).toBe(false);
  });
});

describe("monthly report", () => {
  it("splits spending exactly into on and off budget, measured at the leaves when computed", () => {
    const report = monthly_report(line_tree(lines), august, "2026-08", "computed");

    expect(report.spent).toBe(1435);
    expect(report.on_budget_expense).toBe(1300);
    expect(report.off_budget_expense).toBe(135);
    expect(report.on_budget_expense + report.off_budget_expense).toBe(report.spent);
    expect(report.overspent).toBe(50);
    expect(report.unbudgeted).toEqual({ income: 0, expense: 85 });
  });

  it("counts income short of plan as off budget though it never arrived", () => {
    const report = monthly_report(line_tree(lines), august, "2026-08", "computed");

    expect(report.income).toBe(2800);
    expect(report.on_budget_income).toBe(2800);
    expect(report.shortfall).toBe(200);
    expect(report.off_budget_income).toBe(200);
    expect(report.on_budget_income + report.off_budget_income - report.shortfall).toBe(report.income);
    expect(report.balance).toBe(1365);
  });

  it("itemises every part of off budget by path, adding up to the figures", () => {
    const report = monthly_report(line_tree(lines), august, "2026-08", "computed");

    expect(report.off_budget.map((item) => [item.label, item.total])).toEqual([
      ["Housing / Power", 50],
      ["Salary", 200],
      ["Unbudgeted spending", 85],
    ]);
    const spending = report.off_budget.reduce((total, item) => total + item.overspent, 0);
    expect(spending).toBe(report.off_budget_expense);
  });

  it("measures a cap against its whole subtree and not its children apart", () => {
    const report = monthly_report(line_tree(lines), august, "2026-08", "cap");

    expect(report.off_budget.map((item) => [item.label, item.overspent])).toContainEqual(["Housing", 100]);
    expect(report.off_budget.some((item) => item.label.startsWith("Housing /"))).toBe(false);
    expect(report.on_budget_expense).toBe(1250);
  });

  it("signs variance so negative reads as off plan for both columns", () => {
    const report = monthly_report(line_tree(lines), august, "2026-08", "computed");

    expect(report.expense_variance.find((entry) => entry.id === "housing")).toMatchObject({ budgeted: 1300, actual: 1350, variance: -50, off_plan: true });
    expect(report.expense_variance.find((entry) => entry.id === "rent")).toMatchObject({ variance: 0, off_plan: false });
    expect(report.income_variance.find((entry) => entry.id === "salary")).toMatchObject({ budgeted: 3000, actual: 2800, variance: -200, off_plan: true });
    expect(report.income_transactions.map((transaction) => transaction.id)).toEqual(["salary"]);
  });

  it("reads a transaction charged to a deleted line as unbudgeted, and a negative allocation as none", () => {
    const report = monthly_report(line_tree([line("food", null, 0, "Food", 0, -20)]), [spent("lunch", "2026-08-02", 12, "gone"), spent("snack", "2026-08-02", 3, "food")], "2026-08", "computed");

    expect(report.unbudgeted.expense).toBe(12);
    expect(report.on_budget_expense).toBe(0);
    expect(report.off_budget_expense).toBe(15);
  });
});

describe("trend", () => {
  it("gives the months ending with the one viewed, oldest first, empty ones as zeroes", () => {
    const trend = monthly_trend(line_tree(lines), august, "2026-08", 3, "computed");

    expect(trend.map((month) => month.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(trend[0]).toEqual({ month: "2026-06", income: 0, spent: 0, balance: 0, on_budget: 0, off_budget: 0 });
    expect(trend[1]).toMatchObject({ spent: 40, on_budget: 40 });
    expect(trend[2]).toMatchObject({ spent: 1435, on_budget: 1300, off_budget: 135 });
  });
});
