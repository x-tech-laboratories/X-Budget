// Every change to a budget's lines and transactions kept as versions, so any version can be restored and a deleted line
// or transaction brought back; a line comes back with the lines deleted along with it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { create_history, type Version } from "@x-tech-laboratories/x-libs/history";
import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";

import type { BudgetLine, BudgetTransaction } from "./model.ts";

// ── Rows ─────────────────────────────────────────────────────────────────────

const line_columns = ["id", "budget_id", "parent_id", "position", "title", "income", "expense", "notes"] as const;
const transaction_columns = ["id", "budget_id", "date", "description", "income", "expense", "line_id"] as const;

function read_row<Row>(database: SqlDatabase, table: string, columns: readonly string[], id: string): Row | null {
  const row = database.prepare(`SELECT ${columns.join(", ")} FROM ${table} WHERE id = ?`).get(id);
  return row ? ({ ...(row as object) } as Row) : null;
}

// Puts the row back as the version has it, adding it when it is gone.
function write_row(database: SqlDatabase, table: string, columns: readonly string[], row: Record<string, unknown>): void {
  const values = columns.map((column) => (row[column] ?? null) as string | number | null);
  database.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...values);
}

// ── Histories ────────────────────────────────────────────────────────────────

export const line_history = create_history<BudgetLine>({
  name: "budget_line",
  item_table: "budget_lines",
  watches: [{ table: "budget_lines", item_columns: ["id"] }],
  read: (database, id) => read_row(database, "budget_lines", line_columns, id),
  apply: (database, _id, line) => write_row(database, "budget_lines", line_columns, { ...line }),
  parent_of: (line) => line.parent_id,
});

export const transaction_history = create_history<BudgetTransaction>({
  name: "budget_transaction",
  item_table: "budget_transactions",
  watches: [{ table: "budget_transactions", item_columns: ["id"] }],
  read: (database, id) => read_row(database, "budget_transactions", transaction_columns, id),
  apply: (database, _id, transaction) => write_row(database, "budget_transactions", transaction_columns, { ...transaction }),
});

export const budget_histories = [line_history, transaction_history];

// ── Calls ────────────────────────────────────────────────────────────────────

export type LineVersion = Version<BudgetLine> & { item: "line" };
export type TransactionVersion = Version<BudgetTransaction> & { item: "transaction" };
export type BudgetVersion = LineVersion | TransactionVersion;

// The latest changes to one budget's lines and transactions, newest first.
export function list_recent_versions(database: SqlDatabase, budget_id: string, limit: number): BudgetVersion[] {
  // Each history is read deeper than the limit, since another budget's changes are left out.
  const depth = limit * 4;
  const lines = line_history.read_recent(database, depth).map((version): BudgetVersion => ({ ...version, item: "line" }));
  const transactions = transaction_history.read_recent(database, depth).map((version): BudgetVersion => ({ ...version, item: "transaction" }));
  return [...lines, ...transactions]
    .filter((version) => version.snapshot.budget_id === budget_id)
    .sort((first, second) => second.changed_at.localeCompare(first.changed_at))
    .slice(0, limit);
}
