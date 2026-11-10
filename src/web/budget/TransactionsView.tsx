// The Transactions page: what actually came in and went out in one month, each charged to a line of the plan or left
// unbudgeted.

// ── Imports ──────────────────────────────────────────────────────────────────

import { is_day, this_month, today } from "@x-tech-laboratories/x-libs/dates";
import { CommitInput, NumberField, PeriodStepper, TreeSelect } from "@x-tech-laboratories/x-libs/web/react/controls";
import { Tile, Tiles, Toolbar } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { DataTable, type TableColumn } from "@x-tech-laboratories/x-libs/web/react/table";

import { line_title, type BudgetLine, type BudgetTransaction } from "../../shared/budget/model.ts";
import { calls, use_data } from "../api.ts";
import { Amount, attempt, BudgetPage, use_viewed_month, type BudgetContext, type Money } from "./common.tsx";

// ── Rows ─────────────────────────────────────────────────────────────────────

// A row carries the lines it may be charged to, so the picker never offers stale ones.
export interface TransactionRow {
  transaction: BudgetTransaction;
  lines: BudgetLine[];
  money: Money;
}

function save(transaction: BudgetTransaction, changes: Partial<BudgetTransaction>): void {
  attempt(calls().update_budget_transaction(transaction.id, changes));
}

// ── Columns ──────────────────────────────────────────────────────────────────

const columns: TableColumn<TransactionRow>[] = [
  {
    id: "date",
    label: "Date",
    sort: (row) => row.transaction.date,
    // A cleared date is not taken, so the transaction never drops out of every month.
    cell: ({ transaction }) => (
      <input type="date" aria-label={`${transaction.description || "Transaction"} date`} value={transaction.date} onChange={(event) => is_day(event.currentTarget.value) && save(transaction, { date: event.currentTarget.value })} />
    ),
  },
  {
    id: "description",
    label: "Description",
    sort: (row) => row.transaction.description.toLocaleLowerCase(),
    cell: ({ transaction }) => (
      <CommitInput
        type="text"
        aria-label="Description"
        placeholder="Description"
        value={transaction.description}
        on_commit={(event) => event.currentTarget.value !== transaction.description && save(transaction, { description: event.currentTarget.value })}
      />
    ),
  },
  ...(["income", "expense"] as const).map((column) => ({
    id: column,
    label: column === "income" ? "Income" : "Expense",
    sort: (row: TransactionRow) => row.transaction[column],
    cell: ({ transaction, money }: TransactionRow) => (
      <NumberField
        bare
        label={`${transaction.description || "Transaction"} ${column}`}
        value={transaction[column]}
        step={money.step}
        on_change={(value) => (value ?? 0) !== transaction[column] && save(transaction, { [column]: value ?? 0 })}
      />
    ),
  })),
  {
    id: "balance",
    label: "Balance",
    sort: (row) => row.transaction.income - row.transaction.expense,
    cell: ({ transaction, money }) => <Amount value={transaction.income - transaction.expense} money={money} />,
  },
  {
    id: "line",
    label: "Line",
    // A line deleted since shows as unbudgeted, as the report counts it.
    cell: ({ transaction, lines }) => (
      <TreeSelect
        label={`${transaction.description || "Transaction"} line`}
        items={lines}
        name_of={line_title}
        value={lines.some((line) => line.id === transaction.line_id) ? transaction.line_id! : ""}
        blank_label="Unbudgeted"
        on_change={(line_id) => save(transaction, { line_id: line_id || null })}
      />
    ),
  },
  {
    id: "actions",
    label: "Actions",
    header: "",
    hideable: false,
    movable: false,
    cell: ({ transaction }) => (
      <button type="button" className="icon remove" aria-label={`Delete ${transaction.description || "transaction"}`} onClick={() => attempt(calls().delete_budget_transaction(transaction.id))}>
        ×
      </button>
    ),
  },
];

// ── Ledger ───────────────────────────────────────────────────────────────────

function Ledger({ budget, money, settings }: BudgetContext) {
  const [month, set_month] = use_viewed_month();
  const transactions = use_data((api) => api.list_budget_transactions(budget.id, month), [budget.id, month]);
  const plan = use_data((api) => api.get_budget_plan(budget.id), [budget.id]);

  // A new transaction lands in the month on screen: today in this month, else the month's first day.
  const add = () => attempt(calls().add_budget_transaction(budget.id, month === this_month() ? today() : `${month}-01`));

  return (
    <div className="stack">
      <Toolbar>
        <PeriodStepper label="Month" period="month" value={month} on_change={set_month} locale={money.locale || undefined} />
        <button type="button" className="accent solid" onClick={add}>Add transaction</button>
      </Toolbar>
      <Loaded resource={transactions}>
        {(listed) => {
          const income = listed.reduce((total, transaction) => total + transaction.income, 0);
          const spent = listed.reduce((total, transaction) => total + transaction.expense, 0);
          const lines = plan.data?.lines ?? [];
          return (
            <>
              <Tiles>
                <Tile label="Income" value={money.format(income)} />
                <Tile label="Spent" value={money.format(spent)} />
                <Tile label="Balance" value={money.format(income - spent)} tone={income - spent < 0 ? "bad" : "good"} />
              </Tiles>
              {listed.length === 0 ? (
                <p className="muted">Nothing recorded this month.</p>
              ) : (
                <DataTable
                  caption="Transactions"
                  columns={columns}
                  rows={listed.map((transaction) => ({ transaction, lines, money }))}
                  row_key={(row) => row.transaction.id}
                  hidden_columns={settings["budget.transaction_hidden_columns"] as string[]}
                  on_hidden_columns_change={(hidden) => attempt(calls().set_setting("budget.transaction_hidden_columns", hidden))}
                  fill_last_column={false}
                />
              )}
            </>
          );
        }}
      </Loaded>
    </div>
  );
}

export function TransactionsView() {
  return (
    <BudgetPage title="Transactions" subtitle="What actually came in and went out, month by month.">
      {(context) => <Ledger {...context} />}
    </BudgetPage>
  );
}
