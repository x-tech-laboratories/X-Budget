// The budget's rules: what each line's totals are under the chosen parent rule, and how a month's transactions measure up
// against the plan. Every record, planned or actual, carries an income and an expense, and its balance is one less the
// other, so a line with only an expense is a bill and one with only income is a paycheck.

// ── Imports ──────────────────────────────────────────────────────────────────

import { month_of, shift_month } from "@x-tech-laboratories/x-libs/dates";
import { by_position, nest, type TreeNode } from "@x-tech-laboratories/x-libs/web/tree";

// ── Shapes ───────────────────────────────────────────────────────────────────

// How a parent line's amounts relate to its children's: their sum, its own plus their sum, or a cap they draw on.
export type RollupMode = "computed" | "additive" | "cap";

export const rollup_modes: readonly RollupMode[] = ["computed", "additive", "cap"];

export interface Amounts {
  income: number;
  expense: number;
}

export interface Budget {
  id: string;
  name: string;
  position: number;
}

export interface BudgetLine extends Amounts {
  id: string;
  budget_id: string;
  parent_id: string | null;
  position: number;
  title: string;
  notes: string;
}

export interface BudgetTransaction extends Amounts {
  id: string;
  budget_id: string;
  // A local day such as "2026-08-01".
  date: string;
  description: string;
  // The line it is charged to; null, or a line since deleted, leaves it unbudgeted.
  line_id: string | null;
}

export interface LineTotals extends Amounts {
  balance: number;
  children_income: number;
  children_expense: number;
  is_leaf: boolean;
  // Under a cap, the children spent more than the parent allows.
  over: boolean;
}

export type LineNode = TreeNode<BudgetLine>;

// ── Lines ────────────────────────────────────────────────────────────────────

export function is_rollup_mode(value: unknown): value is RollupMode {
  return rollup_modes.includes(value as RollupMode);
}

// Siblings by position; a line whose parent is gone sits at the top rather than vanishing.
export function line_tree(lines: BudgetLine[]): LineNode[] {
  return nest([...lines].sort(by_position));
}

export function line_title(line: { title: string }): string {
  return line.title.trim() || "Untitled";
}

// Each line's whole path, such as "Housing / Rent", so two lines sharing a title stay apart.
export function line_paths(nodes: LineNode[]): Map<string, string> {
  const paths = new Map<string, string>();
  const walk = (node: LineNode, parent_path: string) => {
    const path = parent_path ? `${parent_path} / ${line_title(node.item)}` : line_title(node.item);
    paths.set(node.item.id, path);
    for (const child of node.children) walk(child, path);
  };
  for (const node of nodes) walk(node, "");
  return paths;
}

// Ids of every line with children, the ones Collapse all folds.
export function parent_ids(nodes: LineNode[]): string[] {
  const ids: string[] = [];
  const walk = (node: LineNode) => {
    if (node.children.length === 0) return;
    ids.push(node.item.id);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return ids;
}

// ── Totals ───────────────────────────────────────────────────────────────────

// Each line's totals under the parent rule, applied to income and expense apart; only what was typed is ever stored.
export function compute_totals(nodes: LineNode[], mode: RollupMode): Map<string, LineTotals> {
  const totals = new Map<string, LineTotals>();
  const walk = (node: LineNode): Amounts => {
    const line = node.item;
    const is_leaf = node.children.length === 0;
    let children_income = 0;
    let children_expense = 0;
    for (const child of node.children) {
      const resolved = walk(child);
      children_income += resolved.income;
      children_expense += resolved.expense;
    }

    let income = children_income;
    let expense = children_expense;
    if (is_leaf || mode === "cap") {
      income = line.income;
      expense = line.expense;
    } else if (mode === "additive") {
      income = line.income + children_income;
      expense = line.expense + children_expense;
    }

    const over = mode === "cap" && !is_leaf && children_expense > line.expense;
    totals.set(line.id, { income, expense, balance: income - expense, children_income, children_expense, is_leaf, over });
    return { income, expense };
  };
  nodes.forEach(walk);
  return totals;
}

// The plan's bottom line, from the top lines' totals.
export function grand_totals(nodes: LineNode[], totals: Map<string, LineTotals>): Amounts & { balance: number } {
  let income = 0;
  let expense = 0;
  for (const node of nodes) {
    income += totals.get(node.item.id)?.income ?? 0;
    expense += totals.get(node.item.id)?.expense ?? 0;
  }
  return { income, expense, balance: income - expense };
}

// ── Months ───────────────────────────────────────────────────────────────────

export interface Measured {
  id: string;
  label: string;
  budgeted: Amounts;
  actual: Amounts;
  within_expense: number;
  within_income: number;
  overspent: number;
  shortfall: number;
  surplus: number;
}

interface ResolvedMonth {
  month: string;
  monthly: BudgetTransaction[];
  // Each line's actual with its descendants'.
  actuals: Map<string, Amounts>;
  measured: Measured[];
  unbudgeted: Amounts;
  income: number;
  spent: number;
  overspent: number;
  shortfall: number;
  surplus: number;
  on_budget_expense: number;
  off_budget_expense: number;
  on_budget_income: number;
  off_budget_income: number;
}

const no_amounts = (): Amounts => ({ income: 0, expense: 0 });

// An allocation below zero is no limit anything can stay within, so it counts as none.
function allocation(line: BudgetLine): Amounts {
  return { income: Math.max(0, line.income), expense: Math.max(0, line.expense) };
}

// The lines a month is measured against, each with the allocation that is its own and the actual charged to it, never
// counting an allocation twice: under computed only leaves own one, under additive every line owns what was typed, and
// under a cap the parent is measured against its whole subtree and its descendants not at all.
function measurable_lines(nodes: LineNode[], mode: RollupMode, direct: Map<string, Amounts>, rolled: Map<string, Amounts>): Omit<Measured, "within_expense" | "within_income" | "overspent" | "shortfall" | "surplus">[] {
  const measurable: ReturnType<typeof measurable_lines> = [];
  const walk = (node: LineNode, path: string) => {
    const line = node.item;
    const label = path ? `${path} / ${line_title(line)}` : line_title(line);
    const has_children = node.children.length > 0;
    if (mode === "cap" && has_children) {
      measurable.push({ id: line.id, label, budgeted: allocation(line), actual: rolled.get(line.id) ?? no_amounts() });
      return;
    }
    const budgeted = mode === "computed" && has_children ? no_amounts() : allocation(line);
    measurable.push({ id: line.id, label, budgeted, actual: direct.get(line.id) ?? no_amounts() });
    for (const child of node.children) walk(child, label);
  };
  for (const node of nodes) walk(node, "");
  return measurable;
}

export function transactions_in_month(transactions: BudgetTransaction[], month: string): BudgetTransaction[] {
  return transactions.filter((transaction) => month_of(transaction.date) === month);
}

// On budget is every amount that stayed within the limits of the line it was charged to; off budget is every amount
// that broke them, plus anything charged to no line, which had no limit to stay within.
function resolve_month(nodes: LineNode[], transactions: BudgetTransaction[], month: string, mode: RollupMode): ResolvedMonth {
  const known_ids = new Set<string>();
  const collect = (node: LineNode) => {
    known_ids.add(node.item.id);
    node.children.forEach(collect);
  };
  nodes.forEach(collect);

  const monthly = transactions_in_month(transactions, month);
  const direct = new Map<string, Amounts>();
  const unbudgeted = no_amounts();
  let income = 0;
  let spent = 0;
  for (const transaction of monthly) {
    income += transaction.income;
    spent += transaction.expense;
    const target = transaction.line_id && known_ids.has(transaction.line_id) ? direct.get(transaction.line_id) ?? direct.set(transaction.line_id, no_amounts()).get(transaction.line_id)! : unbudgeted;
    target.income += transaction.income;
    target.expense += transaction.expense;
  }

  const actuals = new Map<string, Amounts>();
  const roll_up = (node: LineNode): Amounts => {
    const own = direct.get(node.item.id) ?? no_amounts();
    const total = { ...own };
    for (const child of node.children) {
      const resolved = roll_up(child);
      total.income += resolved.income;
      total.expense += resolved.expense;
    }
    actuals.set(node.item.id, total);
    return total;
  };
  nodes.forEach(roll_up);

  const measured = measurable_lines(nodes, mode, direct, actuals).map((entry) => ({
    ...entry,
    within_expense: Math.min(entry.actual.expense, entry.budgeted.expense),
    within_income: Math.min(entry.actual.income, entry.budgeted.income),
    overspent: Math.max(0, entry.actual.expense - entry.budgeted.expense),
    shortfall: Math.max(0, entry.budgeted.income - entry.actual.income),
    surplus: Math.max(0, entry.actual.income - entry.budgeted.income),
  }));

  const sum = (key: "within_expense" | "within_income" | "overspent" | "shortfall" | "surplus") => measured.reduce((total, entry) => total + entry[key], 0);
  const overspent = sum("overspent");
  const shortfall = sum("shortfall");
  const surplus = sum("surplus");

  // Kept per column, since money in added to money out means nothing; a shortfall never was cash, so income cannot split exactly.
  return {
    month,
    monthly,
    actuals,
    measured,
    unbudgeted,
    income,
    spent,
    overspent,
    shortfall,
    surplus,
    on_budget_expense: sum("within_expense"),
    off_budget_expense: overspent + unbudgeted.expense,
    on_budget_income: sum("within_income"),
    off_budget_income: surplus + shortfall + unbudgeted.income,
  };
}

// ── Report ───────────────────────────────────────────────────────────────────

export interface Variance {
  id: string;
  label: string;
  budgeted: number;
  actual: number;
  // Negative always reads as off plan: overspent for expenses, short for income.
  variance: number;
  off_plan: boolean;
}

export interface OffBudgetItem {
  id: string;
  label: string;
  overspent: number;
  shortfall: number;
  surplus: number;
  total: number;
}

export interface MonthlyReport {
  month: string;
  income: number;
  spent: number;
  balance: number;
  on_budget_expense: number;
  off_budget_expense: number;
  on_budget_income: number;
  off_budget_income: number;
  overspent: number;
  shortfall: number;
  surplus: number;
  unbudgeted: Amounts;
  // Every part of the off-budget figures, adding back up to them exactly.
  off_budget: OffBudgetItem[];
  expense_variance: Variance[];
  income_variance: Variance[];
  income_transactions: BudgetTransaction[];
}

export interface TrendMonth {
  month: string;
  income: number;
  spent: number;
  balance: number;
  // Spending's split, the one that adds up to what was spent and so can be drawn as one bar.
  on_budget: number;
  off_budget: number;
}

export function monthly_report(nodes: LineNode[], transactions: BudgetTransaction[], month: string, mode: RollupMode): MonthlyReport {
  const totals = compute_totals(nodes, mode);
  const resolved = resolve_month(nodes, transactions, month, mode);
  const paths = line_paths(nodes);

  // A line's actual includes its descendants', so a parent compares with the total its parent rule gives it.
  const compare = (column: keyof Amounts, sign: 1 | -1): Variance[] =>
    [...paths.keys()]
      .map((id) => ({ id, budgeted: totals.get(id)?.[column] ?? 0, actual: resolved.actuals.get(id)?.[column] ?? 0 }))
      .filter((entry) => entry.budgeted !== 0 || entry.actual !== 0)
      .map((entry) => {
        const variance = sign * (entry.budgeted - entry.actual);
        return { ...entry, label: paths.get(entry.id)!, variance, off_plan: variance < 0 };
      });

  const off_budget: OffBudgetItem[] = resolved.measured
    .filter((entry) => entry.overspent > 0 || entry.shortfall > 0 || entry.surplus > 0)
    .map((entry) => ({ id: entry.id, label: entry.label, overspent: entry.overspent, shortfall: entry.shortfall, surplus: entry.surplus, total: entry.overspent + entry.shortfall + entry.surplus }));
  if (resolved.unbudgeted.expense > 0) {
    off_budget.push({ id: "unbudgeted-expense", label: "Unbudgeted spending", overspent: resolved.unbudgeted.expense, shortfall: 0, surplus: 0, total: resolved.unbudgeted.expense });
  }
  if (resolved.unbudgeted.income > 0) {
    off_budget.push({ id: "unbudgeted-income", label: "Unbudgeted income", overspent: 0, shortfall: 0, surplus: resolved.unbudgeted.income, total: resolved.unbudgeted.income });
  }

  return {
    month,
    income: resolved.income,
    spent: resolved.spent,
    balance: resolved.income - resolved.spent,
    on_budget_expense: resolved.on_budget_expense,
    off_budget_expense: resolved.off_budget_expense,
    on_budget_income: resolved.on_budget_income,
    off_budget_income: resolved.off_budget_income,
    overspent: resolved.overspent,
    shortfall: resolved.shortfall,
    surplus: resolved.surplus,
    unbudgeted: resolved.unbudgeted,
    off_budget,
    expense_variance: compare("expense", 1),
    income_variance: compare("income", -1),
    income_transactions: resolved.monthly.filter((transaction) => transaction.income !== 0).sort((first, second) => first.date.localeCompare(second.date)),
  };
}

// The months ending with the one given, oldest first, with empty months as zeroes so the series has no gaps.
export function monthly_trend(nodes: LineNode[], transactions: BudgetTransaction[], last_month: string, count: number, mode: RollupMode): TrendMonth[] {
  const trend: TrendMonth[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const resolved = resolve_month(nodes, transactions, shift_month(last_month, -offset), mode);
    trend.push({
      month: resolved.month,
      income: resolved.income,
      spent: resolved.spent,
      balance: resolved.income - resolved.spent,
      on_budget: resolved.on_budget_expense,
      off_budget: resolved.off_budget_expense,
    });
  }
  return trend;
}
