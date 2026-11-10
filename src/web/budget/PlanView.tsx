// The Plan page: the budget's lines as a tree edited in place, each with its totals under the parent rule set in
// Settings, and the plan's bottom line.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useState, type KeyboardEvent } from "react";
import { CommitInput, NumberField } from "@x-tech-laboratories/x-libs/web/react/controls";
import { confirm_dialog } from "@x-tech-laboratories/x-libs/web/react/dialog";
import { Tile, Tiles, Toolbar } from "@x-tech-laboratories/x-libs/web/react/layout";
import { MenuButton } from "@x-tech-laboratories/x-libs/web/react/menu_button";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { DataTable, type TableColumn } from "@x-tech-laboratories/x-libs/web/react/table";
import { move_for_key, type KeyMove } from "@x-tech-laboratories/x-libs/web/tree";

import { line_title, line_tree, parent_ids, type BudgetLine, type LineNode, type LineTotals, type RollupMode } from "../../shared/budget/model.ts";
import type { BudgetPlan } from "../../shared/budget/store.ts";
import { calls, use_data } from "../api.ts";
import { Amount, attempt, BudgetPage, type BudgetContext, type Money } from "./common.tsx";

// ── Rows ─────────────────────────────────────────────────────────────────────

// A row carries all its cells show, so a row that draws again only when it changes never shows stale totals.
export interface PlanRow {
  line: BudgetLine;
  totals: LineTotals;
  mode: RollupMode;
  money: Money;
  // Every line of the budget, which a move is worked out against.
  lines: BudgetLine[];
  children: PlanRow[];
}

function plan_rows(plan: BudgetPlan, money: Money): PlanRow[] {
  const row_of = (node: LineNode): PlanRow => ({
    line: node.item,
    totals: plan.totals[node.item.id]!,
    mode: plan.mode,
    money,
    lines: plan.lines,
    children: node.children.map(row_of),
  });
  return line_tree(plan.lines).map(row_of);
}

function count_below(row: PlanRow): number {
  return row.children.reduce((total, child) => total + 1 + count_below(child), 0);
}

// ── Actions ──────────────────────────────────────────────────────────────────

const move_keys: Record<string, KeyMove> = { ArrowUp: "up", ArrowDown: "down", ArrowRight: "indent", ArrowLeft: "outdent" };

function move_line(row: PlanRow, direction: KeyMove): void {
  const target = move_for_key(row.line, direction, row.lines);
  if (target) attempt(calls().move_budget_line(row.line.id, target.parent_id, target.position));
}

// Transactions charged to a deleted line stay, unbudgeted, so only a line with lines under it asks first.
function delete_line(row: PlanRow): void {
  const title = line_title(row.line);
  const below = count_below(row);
  if (below === 0) return attempt(calls().delete_budget_line(row.line.id));
  confirm_dialog({
    title: `Delete ${title}?`,
    message: `${title} and the ${below} line(s) under it go. Transactions charged to them stay, as unbudgeted.`,
    confirm_label: "Delete",
    danger: true,
    run: async () => void (await calls().delete_budget_line(row.line.id)),
  });
}

function save_amount(line: BudgetLine, column: "income" | "expense", value: number | null): void {
  const next = value ?? 0;
  if (next !== line[column]) attempt(calls().update_budget_line(line.id, { [column]: next }));
}

// ── Cells ────────────────────────────────────────────────────────────────────

// Computed parents show their children's sum; a cap shows what its children used, and own plus children shows the whole.
function AmountCell({ row, column }: { row: PlanRow; column: "income" | "expense" }) {
  const { line, totals, mode, money } = row;
  const has_children = row.children.length > 0;
  if (has_children && mode === "computed") return <Amount value={totals[column]} money={money} />;

  const field = <NumberField bare label={`${line_title(line)} ${column}`} value={line[column]} step={money.step} on_change={(value) => save_amount(line, column, value)} />;
  if (!has_children) return field;
  const used = column === "income" ? totals.children_income : totals.children_expense;
  return (
    <div className="plan-amount">
      {field}
      <span className="muted small">{mode === "cap" ? `${money.format(used)} used` : `${money.format(totals[column])} with the lines under it`}</span>
    </div>
  );
}

function line_menu(row: PlanRow, on_add: (parent_id: string) => void) {
  const can = (direction: KeyMove) => move_for_key(row.line, direction, row.lines) !== null;
  return [
    { label: "Add a line under it", run: () => on_add(row.line.id) },
    { label: "Move up", hint: "Alt+↑", disabled: !can("up"), run: () => move_line(row, "up"), separator_before: true },
    { label: "Move down", hint: "Alt+↓", disabled: !can("down"), run: () => move_line(row, "down") },
    { label: "Move under the line above", hint: "Alt+→", disabled: !can("indent"), run: () => move_line(row, "indent") },
    { label: "Move out of its parent", hint: "Alt+←", disabled: !can("outdent"), run: () => move_line(row, "outdent") },
    { label: "Delete", danger: true, separator_before: true, run: () => delete_line(row) },
  ];
}

function plan_columns(on_add: (parent_id: string) => void): TableColumn<PlanRow>[] {
  return [
    {
      id: "title",
      label: "Line",
      hideable: false,
      movable: false,
      cell: (row) => (
        <CommitInput
          type="text"
          aria-label="Line"
          placeholder="Untitled"
          value={row.line.title}
          on_commit={(event) => {
            if (event.currentTarget.value !== row.line.title) attempt(calls().update_budget_line(row.line.id, { title: event.currentTarget.value }));
          }}
        />
      ),
    },
    { id: "income", label: "Income", cell: (row) => <AmountCell row={row} column="income" /> },
    { id: "expense", label: "Expense", cell: (row) => <AmountCell row={row} column="expense" /> },
    { id: "balance", label: "Balance", sort: (row) => row.totals.balance, cell: (row) => <Amount value={row.totals.balance} money={row.money} /> },
    {
      id: "notes",
      label: "Notes",
      cell: (row) => (
        <CommitInput
          type="text"
          aria-label={`${line_title(row.line)} notes`}
          placeholder="Notes"
          value={row.line.notes}
          on_commit={(event) => {
            if (event.currentTarget.value !== row.line.notes) attempt(calls().update_budget_line(row.line.id, { notes: event.currentTarget.value }));
          }}
        />
      ),
    },
    {
      id: "actions",
      label: "Actions",
      header: "",
      hideable: false,
      movable: false,
      cell: (row) => <MenuButton label={`${line_title(row.line)} actions`} items={() => line_menu(row, on_add)} />,
    },
  ];
}

// ── Plan ─────────────────────────────────────────────────────────────────────

const mode_hints: Record<RollupMode, string> = {
  computed: "A parent line is the sum of the lines under it.",
  additive: "A parent line's own amounts are added to the lines under it.",
  cap: "A parent line is a cap the lines under it draw on.",
};

function PlanTable({ budget, money, settings }: BudgetContext) {
  const plan = use_data((api) => api.get_budget_plan(budget.id), [budget.id]);
  // Folded lines are this page's view alone, never stored.
  const [collapsed, set_collapsed] = useState<string[]>([]);

  const add_line = (parent_id: string | null) => {
    if (parent_id) set_collapsed((current) => current.filter((id) => id !== parent_id));
    attempt(calls().add_budget_line(budget.id, parent_id));
  };
  const columns = plan_columns(add_line);
  const set_setting = (key: string, value: unknown) => attempt(calls().set_setting(key, value));

  return (
    <Loaded resource={plan}>
      {(loaded) => {
        const parents = parent_ids(line_tree(loaded.lines));
        const expanded = parents.filter((id) => !collapsed.includes(id));
        return (
          <div className="stack">
            <p className="muted">{mode_hints[loaded.mode]}</p>
            <Tiles>
              <Tile label="Planned income" value={money.format(loaded.total.income)} />
              <Tile label="Planned spending" value={money.format(loaded.total.expense)} />
              <Tile label="Planned balance" value={money.format(loaded.total.balance)} tone={loaded.total.balance < 0 ? "bad" : "good"} />
            </Tiles>
            <Toolbar>
              <button type="button" className="accent solid" onClick={() => add_line(null)}>Add line</button>
              <button type="button" disabled={collapsed.length === 0} onClick={() => set_collapsed([])}>Expand all</button>
              <button type="button" disabled={expanded.length === 0} onClick={() => set_collapsed(parents)}>Collapse all</button>
            </Toolbar>
            {loaded.lines.length === 0 ? (
              <p className="muted">No lines yet. Add one for each income and each expense you plan, and nest them as you like.</p>
            ) : (
              <DataTable
                caption={`${budget.name} plan`}
                columns={columns}
                rows={plan_rows(loaded, money)}
                row_key={(row) => row.line.id}
                get_children={(row) => row.children}
                expanded={expanded}
                on_expanded_change={(open) => set_collapsed(parents.filter((id) => !open.includes(id)))}
                row_class={(row) => (row.totals.over ? "tone-fill-bad" : undefined)}
                row_title={(row) => (row.totals.over ? "The lines under it spend more than this cap" : undefined)}
                on_row_key_down={(row, event: KeyboardEvent<HTMLTableRowElement>) => {
                  const direction = move_keys[event.key];
                  if (!event.altKey || !direction) return;
                  event.preventDefault();
                  move_line(row, direction);
                }}
                column_order={settings["budget.plan_column_order"] as string[]}
                on_column_order_change={(order) => set_setting("budget.plan_column_order", order)}
                hidden_columns={settings["budget.plan_hidden_columns"] as string[]}
                on_hidden_columns_change={(hidden) => set_setting("budget.plan_hidden_columns", hidden)}
                fill_last_column={false}
              />
            )}
          </div>
        );
      }}
    </Loaded>
  );
}

export function PlanView() {
  return (
    <BudgetPage title="Plan" subtitle="What you expect to come in and go out each month.">
      {(context) => <PlanTable {...context} />}
    </BudgetPage>
  );
}
