// Budgets, each a tree of planned lines and a ledger of the transactions that actually moved, and the plan's totals and
// each month's report worked out from them.

// ── Imports ──────────────────────────────────────────────────────────────────

import { is_day, is_month, shift_month } from "@x-tech-laboratories/x-libs/dates";
import { round_money } from "@x-tech-laboratories/x-libs/money";
import { in_transaction, type SqlDatabase, type SqlValue } from "@x-tech-laboratories/x-libs/sql";
import { subtree_ids } from "@x-tech-laboratories/x-libs/web/tree";

import { define_feature, new_id } from "../feature.ts";
import { read_setting } from "../settings.ts";
import {
  compute_totals,
  grand_totals,
  is_rollup_mode,
  line_tree,
  monthly_report,
  monthly_trend,
  type Amounts,
  type Budget,
  type BudgetLine,
  type BudgetTransaction,
  type LineTotals,
  type MonthlyReport,
  type RollupMode,
  type TrendMonth,
} from "./model.ts";
import { read_trilium_budget, write_trilium_budget } from "./trilium.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface BudgetSummary extends Budget {
  lines: number;
  transactions: number;
}

export interface BudgetPlan {
  mode: RollupMode;
  lines: BudgetLine[];
  totals: Record<string, LineTotals>;
  total: Amounts & { balance: number };
}

export interface BudgetReport extends MonthlyReport {
  mode: RollupMode;
  trend: TrendMonth[];
}

export type LineChanges = Partial<Pick<BudgetLine, "title" | "income" | "expense" | "notes">>;

export type TransactionChanges = Partial<Pick<BudgetTransaction, "date" | "description" | "income" | "expense" | "line_id">>;

export interface ImportedBudget {
  id: string;
  lines: number;
  transactions: number;
  skipped: number;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const budget_setting_defaults = {
  "budget.rollup_mode": "computed" satisfies RollupMode,
  // How many months the report's trend shows, ending with the month viewed.
  "budget.trend_months": 6,
  "budget.plan_column_order": [] as string[],
  "budget.plan_hidden_columns": [] as string[],
  "budget.transaction_hidden_columns": [] as string[],
};

function rollup_mode_of(database: SqlDatabase): RollupMode {
  const mode = read_setting(database, "budget.rollup_mode", budget_setting_defaults["budget.rollup_mode"]);
  return is_rollup_mode(mode) ? mode : "computed";
}

function trend_months_of(database: SqlDatabase): number {
  const months = Math.floor(Number(read_setting(database, "budget.trend_months", budget_setting_defaults["budget.trend_months"])));
  return Number.isFinite(months) ? Math.min(Math.max(months, 1), 36) : 6;
}

// Amounts are kept to the places shown, so what is stored is what is seen.
function amount_of(database: SqlDatabase, value: unknown): number {
  return round_money(value, read_setting(database, "decimals", 2));
}

// ── Reading ──────────────────────────────────────────────────────────────────

const line_columns = "id, budget_id, parent_id, position, title, income, expense, notes";
const transaction_columns = "id, budget_id, date, description, income, expense, line_id";

function plain<Row>(rows: unknown[]): Row[] {
  return rows.map((row) => ({ ...(row as object) }) as Row);
}

function list_lines(database: SqlDatabase, budget_id: string): BudgetLine[] {
  return plain<BudgetLine>(database.prepare(`SELECT ${line_columns} FROM budget_lines WHERE budget_id = ? ORDER BY position`).all(budget_id));
}

function find_line(database: SqlDatabase, id: string): BudgetLine {
  const row = database.prepare(`SELECT ${line_columns} FROM budget_lines WHERE id = ?`).get(id);
  if (!row) throw new Error(`No budget line ${id}`);
  return { ...(row as unknown as BudgetLine) };
}

// From the first day of the first month to the last day of the last, ordered by day and then as they were added.
function list_transactions_between(database: SqlDatabase, budget_id: string, first_month: string, last_month: string): BudgetTransaction[] {
  const rows = database.prepare(`SELECT ${transaction_columns} FROM budget_transactions WHERE budget_id = ? AND date >= ? AND date < ? ORDER BY date, rowid`).all(budget_id, `${first_month}-01`, `${shift_month(last_month, 1)}-01`);
  return plain<BudgetTransaction>(rows);
}

function check_budget(database: SqlDatabase, id: string): void {
  if (!database.prepare("SELECT 1 FROM budgets WHERE id = ?").get(id)) throw new Error(`No budget ${id}`);
}

function check_month(month: unknown): string {
  if (!is_month(month)) throw new Error(`Not a month: ${String(month)}`);
  return month;
}

// ── Writing ──────────────────────────────────────────────────────────────────

// Only the columns named here are ever written, whatever else the page sends.
function update_columns(database: SqlDatabase, table: string, id: string, values: Record<string, SqlValue | undefined>): void {
  const columns = Object.entries(values).filter(([, value]) => value !== undefined);
  if (columns.length === 0) return;
  const assignments = columns.map(([column]) => `${column} = ?`).join(", ");
  database.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(...columns.map(([, value]) => value as SqlValue), id);
}

function next_position(database: SqlDatabase, budget_id: string, parent_id: string | null): number {
  const { next } = database.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS next FROM budget_lines WHERE budget_id = ? AND parent_id IS ?").get(budget_id, parent_id) as { next: number };
  return next;
}

function insert_line(database: SqlDatabase, line: BudgetLine): void {
  database.prepare(`INSERT INTO budget_lines (${line_columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(line.id, line.budget_id, line.parent_id, line.position, line.title, line.income, line.expense, line.notes);
}

function insert_transaction(database: SqlDatabase, transaction: BudgetTransaction): void {
  database.prepare(`INSERT INTO budget_transactions (${transaction_columns}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(transaction.id, transaction.budget_id, transaction.date, transaction.description, transaction.income, transaction.expense, transaction.line_id);
}

function add_budget(database: SqlDatabase, name: string): string {
  const id = new_id();
  const { next } = database.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS next FROM budgets").get() as { next: number };
  database.prepare("INSERT INTO budgets (id, name, position) VALUES (?, ?, ?)").run(id, name.trim() || "Budget", next);
  return id;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const budget_feature = define_feature({
  id: "budget",
  // No foreign keys: a transaction keeps a deleted line's id and so reads as unbudgeted, and sync may bring a row before its parent.
  migrations: [
    `CREATE TABLE budgets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE budget_lines (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      parent_id TEXT,
      position REAL NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      income REAL NOT NULL DEFAULT 0,
      expense REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX budget_lines_by_budget ON budget_lines (budget_id, parent_id);
    CREATE TABLE budget_transactions (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      income REAL NOT NULL DEFAULT 0,
      expense REAL NOT NULL DEFAULT 0,
      line_id TEXT
    );
    CREATE INDEX budget_transactions_by_date ON budget_transactions (budget_id, date);
    INSERT INTO budgets (id, name, position) VALUES ('main', 'Budget', 0);`,
  ],
  tables: [
    { name: "budgets", key_columns: ["id"] },
    { name: "budget_lines", key_columns: ["id"] },
    { name: "budget_transactions", key_columns: ["id"] },
  ],
  methods: {
    list_budgets: (database: SqlDatabase): BudgetSummary[] =>
      plain<BudgetSummary>(
        database.prepare(`SELECT id, name, position,
          (SELECT COUNT(*) FROM budget_lines WHERE budget_id = budgets.id) AS lines,
          (SELECT COUNT(*) FROM budget_transactions WHERE budget_id = budgets.id) AS transactions
          FROM budgets ORDER BY position, name`).all(),
      ),

    add_budget,

    rename_budget: (database: SqlDatabase, id: string, name: string): void => {
      database.prepare("UPDATE budgets SET name = ? WHERE id = ?").run(name.trim() || "Budget", id);
    },

    // Its lines and transactions go with it; gives how many went.
    delete_budget: (database: SqlDatabase, id: string): { lines: number; transactions: number } =>
      in_transaction(database, () => {
        const lines = database.prepare("DELETE FROM budget_lines WHERE budget_id = ?").run(id).changes;
        const transactions = database.prepare("DELETE FROM budget_transactions WHERE budget_id = ?").run(id).changes;
        database.prepare("DELETE FROM budgets WHERE id = ?").run(id);
        return { lines: Number(lines), transactions: Number(transactions) };
      }),

    // Every line with its totals under the parent rule set, and the plan's bottom line.
    get_budget_plan: (database: SqlDatabase, budget_id: string): BudgetPlan => {
      const mode = rollup_mode_of(database);
      const lines = list_lines(database, budget_id);
      const nodes = line_tree(lines);
      const totals = compute_totals(nodes, mode);
      return { mode, lines, totals: Object.fromEntries(totals), total: grand_totals(nodes, totals) };
    },

    // A new line goes last among its siblings; null adds it at the top level.
    add_budget_line: (database: SqlDatabase, budget_id: string, parent_id: string | null): string => {
      check_budget(database, budget_id);
      if (parent_id !== null && find_line(database, parent_id).budget_id !== budget_id) throw new Error("The parent line is in another budget");
      const id = new_id();
      insert_line(database, { id, budget_id, parent_id, position: next_position(database, budget_id, parent_id), title: "", income: 0, expense: 0, notes: "" });
      return id;
    },

    update_budget_line: (database: SqlDatabase, id: string, changes: LineChanges): void => {
      update_columns(database, "budget_lines", id, {
        title: typeof changes.title === "string" ? changes.title : undefined,
        notes: typeof changes.notes === "string" ? changes.notes : undefined,
        income: changes.income === undefined ? undefined : amount_of(database, changes.income),
        expense: changes.expense === undefined ? undefined : amount_of(database, changes.expense),
      });
    },

    // A line moves with everything under it, anywhere in its budget but inside itself.
    move_budget_line: (database: SqlDatabase, id: string, parent_id: string | null, position: number): void => {
      const line = find_line(database, id);
      if (parent_id !== null) {
        if (subtree_ids(id, list_lines(database, line.budget_id)).has(parent_id)) throw new Error("A line cannot move inside itself");
        if (find_line(database, parent_id).budget_id !== line.budget_id) throw new Error("The parent line is in another budget");
      }
      if (!Number.isFinite(position)) throw new Error("Not a position");
      database.prepare("UPDATE budget_lines SET parent_id = ?, position = ? WHERE id = ?").run(parent_id, position, id);
    },

    // The line and everything under it; their transactions stay, unbudgeted, so the money never drops out of a month.
    delete_budget_line: (database: SqlDatabase, id: string): number => {
      const line = find_line(database, id);
      const ids = [...subtree_ids(id, list_lines(database, line.budget_id))];
      return in_transaction(database, () => {
        const remove = database.prepare("DELETE FROM budget_lines WHERE id = ?");
        for (const each of ids) remove.run(each);
        return ids.length;
      });
    },

    list_budget_transactions: (database: SqlDatabase, budget_id: string, month: string): BudgetTransaction[] =>
      list_transactions_between(database, budget_id, check_month(month), month),

    add_budget_transaction: (database: SqlDatabase, budget_id: string, date: string): string => {
      check_budget(database, budget_id);
      if (!is_day(date)) throw new Error(`Not a day: ${String(date)}`);
      const id = new_id();
      insert_transaction(database, { id, budget_id, date, description: "", income: 0, expense: 0, line_id: null });
      return id;
    },

    // A date that is not a day is ignored, so a transaction never drops out of every month.
    update_budget_transaction: (database: SqlDatabase, id: string, changes: TransactionChanges): void => {
      update_columns(database, "budget_transactions", id, {
        date: is_day(changes.date) ? changes.date : undefined,
        description: typeof changes.description === "string" ? changes.description : undefined,
        income: changes.income === undefined ? undefined : amount_of(database, changes.income),
        expense: changes.expense === undefined ? undefined : amount_of(database, changes.expense),
        line_id: changes.line_id === undefined ? undefined : changes.line_id || null,
      });
    },

    delete_budget_transaction: (database: SqlDatabase, id: string): void => {
      database.prepare("DELETE FROM budget_transactions WHERE id = ?").run(id);
    },

    // The month measured against the plan under the parent rule set, and the months before it for the trend.
    get_budget_report: (database: SqlDatabase, budget_id: string, month: string): BudgetReport => {
      const mode = rollup_mode_of(database);
      const count = trend_months_of(database);
      const nodes = line_tree(list_lines(database, budget_id));
      const transactions = list_transactions_between(database, budget_id, shift_month(check_month(month), -(count - 1)), month);
      return { ...monthly_report(nodes, transactions, month, mode), mode, trend: monthly_trend(nodes, transactions, month, count, mode) };
    },

    // The whole budget in the Trilium add-on's JSON shape.
    export_budget: (database: SqlDatabase, budget_id: string): string => {
      const transactions = plain<BudgetTransaction>(database.prepare(`SELECT ${transaction_columns} FROM budget_transactions WHERE budget_id = ? ORDER BY date, rowid`).all(budget_id));
      return write_trilium_budget(list_lines(database, budget_id), transactions);
    },

    // A file becomes a new budget, so importing never replaces one already here.
    import_budget: (database: SqlDatabase, name: string, text: string): ImportedBudget =>
      in_transaction(database, () => {
        const id = add_budget(database, name);
        const read = read_trilium_budget(text, id, new_id);
        for (const line of read.lines) insert_line(database, { ...line, income: amount_of(database, line.income), expense: amount_of(database, line.expense) });
        for (const transaction of read.transactions) insert_transaction(database, { ...transaction, income: amount_of(database, transaction.income), expense: amount_of(database, transaction.expense) });
        return { id, lines: read.lines.length, transactions: read.transactions.length, skipped: read.skipped };
      }),
  },
  setting_defaults: budget_setting_defaults,
});
