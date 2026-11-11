// The budget calls described for other programs: what each does and the arguments it takes.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { JsonSchema, MethodSpec } from "@x-tech-laboratories/x-libs/api_spec";

import { amount, budget_id, day, id_of, json_file, month, text } from "../api_schemas.ts";

// ── Shapes ───────────────────────────────────────────────────────────────────

const line_changes: JsonSchema = {
  type: "object",
  description: "Only the fields given change.",
  properties: {
    title: text("The line's name, such as Rent."),
    income: { ...amount, description: "What the line expects to come in each month." },
    expense: { ...amount, description: "What the line expects to go out each month." },
    notes: text("A note on the line."),
  },
};

const transaction_changes: JsonSchema = {
  type: "object",
  description: "Only the fields given change; a date that is not a day is ignored.",
  properties: {
    date: day,
    description: text("What moved, such as August rent."),
    income: { ...amount, description: "What came in." },
    expense: { ...amount, description: "What went out." },
    line_id: { type: ["string", "null"], description: "The line it is charged to, or null for unbudgeted." },
  },
};

const version_id: JsonSchema = { type: "string", description: "The version's id, as a list_*_versions or list_budget_changes call gives it." };

// ── Calls ────────────────────────────────────────────────────────────────────

export const budget_api = {
  list_budgets: { description: "Lists the budgets, each with how many lines and transactions it holds.", params: [] },
  add_budget: { description: "Adds an empty budget. Gives back its id.", params: [{ name: "name", schema: text("The budget's name, such as Household.") }] },
  rename_budget: { description: "Renames a budget.", params: [{ name: "id", schema: budget_id }, { name: "name", schema: text("The new name.") }] },
  delete_budget: {
    description: "Deletes a budget with all its lines and transactions. Gives back how many of each went.",
    params: [{ name: "id", schema: budget_id }],
  },

  get_budget_plan: {
    description:
      "Gives a budget's lines, each with its totals under the parent rule set in Settings (computed, additive or cap), and the plan's total income, expense and balance. Lines nest by parent_id and sort by position.",
    params: [{ name: "budget_id", schema: budget_id }],
  },
  add_budget_line: {
    description: "Adds an empty line last among its siblings. Gives back its id.",
    params: [{ name: "budget_id", schema: budget_id }, { name: "parent_id", schema: { type: ["string", "null"], description: "The line to add it under, or null for the top." } }],
  },
  update_budget_line: { description: "Changes a line's title, planned amounts or notes.", params: [{ name: "id", schema: id_of("line") }, { name: "changes", schema: line_changes }] },
  move_budget_line: {
    description: "Moves a line, with everything under it, to a parent and a place among that parent's lines; never inside itself.",
    params: [
      { name: "id", schema: id_of("line") },
      { name: "parent_id", schema: { type: ["string", "null"], description: "The new parent line, or null for the top." } },
      { name: "position", schema: { type: "number", description: "Where among its siblings, which sort by this number; any number between two siblings' places it between them." } },
    ],
  },
  delete_budget_line: {
    description: "Deletes a line and every line under it. Transactions charged to them stay, as unbudgeted. Gives back how many lines went.",
    params: [{ name: "id", schema: id_of("line") }],
  },

  list_budget_transactions: {
    description: "Lists one month's transactions of a budget, by day.",
    params: [{ name: "budget_id", schema: budget_id }, { name: "month", schema: month }],
  },
  add_budget_transaction: {
    description: "Adds an empty transaction on a day; set its amounts and line with update_budget_transaction. Gives back its id.",
    params: [{ name: "budget_id", schema: budget_id }, { name: "date", schema: day }],
  },
  update_budget_transaction: {
    description: "Changes a transaction's day, description, amounts or line.",
    params: [{ name: "id", schema: id_of("transaction") }, { name: "changes", schema: transaction_changes }],
  },
  delete_budget_transaction: { description: "Deletes a transaction.", params: [{ name: "id", schema: id_of("transaction") }] },

  get_budget_report: {
    description:
      "Measures a month against the plan: income, spending and balance; on budget, every amount within the limits of its line, and off budget, every amount past them or unbudgeted, kept per column; what went off budget; each line's plan beside what moved; the month's income; and the months before it as a trend.",
    params: [{ name: "budget_id", schema: budget_id }, { name: "month", schema: month }],
  },

  export_budget: {
    description: "Gives a budget as the Trilium Budget add-on's JSON: nested rows and the transactions naming their row.",
    params: [{ name: "budget_id", schema: budget_id }],
  },
  import_budget: {
    description: "Reads a Trilium Budget add-on file, or one export_budget gave, into a new budget. Gives back its id and how many lines and transactions came in.",
    params: [{ name: "name", schema: text("The new budget's name.") }, { name: "text", schema: json_file }],
  },

  list_line_versions: { description: "Lists every version of one line, newest first, deleted ones included.", params: [{ name: "line_id", schema: id_of("line") }] },
  list_transaction_versions: {
    description: "Lists every version of one transaction, newest first, deleted ones included.",
    params: [{ name: "transaction_id", schema: id_of("transaction") }],
  },
  list_budget_changes: {
    description: "Lists the latest changes to a budget's lines and transactions on every device, newest first.",
    params: [{ name: "budget_id", schema: budget_id }, { name: "limit", schema: { type: "integer", minimum: 1, description: "How many changes to give." } }],
  },
  restore_line_version: {
    description: "Makes a version of a line the current one; a deleted line comes back with the lines deleted along with it.",
    params: [{ name: "version_id", schema: version_id }],
  },
  restore_transaction_version: { description: "Makes a version of a transaction the current one, bringing it back if it was deleted.", params: [{ name: "version_id", schema: version_id }] },
} satisfies Record<string, MethodSpec>;
