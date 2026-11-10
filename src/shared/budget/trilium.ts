// The Trilium Budget add-on's JSON, nested rows and the transactions naming their row, read into a budget's lines and
// transactions and written back in the same shape, so a budget moves between the two and into spreadsheets or scripts.

// ── Imports ──────────────────────────────────────────────────────────────────

import { is_day } from "@x-tech-laboratories/x-libs/dates";

import { line_tree, type Amounts, type BudgetLine, type BudgetTransaction, type LineNode } from "./model.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface TriliumRow extends Amounts {
  id: string;
  title: string;
  notes: string;
  children: TriliumRow[];
}

export interface TriliumTransaction extends Amounts {
  id: string;
  date: string;
  description: string;
  rowId: string | null;
}

export interface ReadBudget {
  lines: BudgetLine[];
  transactions: BudgetTransaction[];
  // Transactions left out because their date is not a day, which no month could show.
  skipped: number;
}

// ── Reading ──────────────────────────────────────────────────────────────────

type Loose = Record<string, unknown> | null | undefined;

function text_of(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number_of(value: unknown): number | null {
  const number = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(number) ? number : null;
}

// Files from before the add-on's 2.0 carry one amount, which only ever held spending.
function amounts_of(record: Loose): Amounts {
  return { income: number_of(record?.income) ?? 0, expense: number_of(record?.expense) ?? (record?.expense === undefined ? number_of(record?.amount) ?? 0 : 0) };
}

// Takes the add-on's document or a bare list of rows; every id is new, so one file can be read into several budgets.
export function read_trilium_budget(text: string, budget_id: string, new_id: () => string): ReadBudget {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const document = parsed as Loose;
  const rows: unknown = Array.isArray(parsed) ? parsed : document?.rows;
  if (!Array.isArray(rows)) throw new Error('Expected a JSON object with a "rows" list.');

  const line_ids = new Map<string, string>();
  const lines: BudgetLine[] = [];
  const read_rows = (list: unknown[], parent_id: string | null) => {
    list.forEach((entry, position) => {
      const row = entry as Loose;
      const id = new_id();
      if (typeof row?.id === "string" && row.id) line_ids.set(row.id, id);
      lines.push({ id, budget_id, parent_id, position, title: text_of(row?.title), notes: text_of(row?.notes), ...amounts_of(row) });
      if (Array.isArray(row?.children)) read_rows(row.children, id);
    });
  };
  read_rows(rows, null);

  const listed: unknown[] = Array.isArray(document?.transactions) ? (document.transactions as unknown[]) : [];
  const transactions = listed
    .map((entry) => entry as Loose)
    .filter((entry) => is_day(entry?.date))
    .map((entry) => ({
      id: new_id(),
      budget_id,
      date: entry!.date as string,
      description: text_of(entry?.description),
      line_id: line_ids.get(text_of(entry?.rowId)) ?? null,
      ...amounts_of(entry),
    }));
  return { lines, transactions, skipped: listed.length - transactions.length };
}

// ── Writing ──────────────────────────────────────────────────────────────────

export function write_trilium_budget(lines: BudgetLine[], transactions: BudgetTransaction[]): string {
  const row_of = (node: LineNode): TriliumRow => ({
    id: node.item.id,
    title: node.item.title,
    income: node.item.income,
    expense: node.item.expense,
    notes: node.item.notes,
    children: node.children.map(row_of),
  });
  const rows = line_tree(lines).map(row_of);
  const written = transactions.map(({ id, date, description, income, expense, line_id }) => ({ id, date, description, income, expense, rowId: line_id }));
  return JSON.stringify({ rows, transactions: written }, null, 4);
}
