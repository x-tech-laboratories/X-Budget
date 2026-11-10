// The Report page: one month measured against the plan, on budget and off budget per column, what went off budget,
// each line's plan beside what moved, the month's income, and the months before it.

// ── Imports ──────────────────────────────────────────────────────────────────

import { format_month } from "@x-tech-laboratories/x-libs/dates";
import { Meters, StackedBarChart } from "@x-tech-laboratories/x-libs/web/react/charts";
import { PeriodStepper } from "@x-tech-laboratories/x-libs/web/react/controls";
import { Section, Tile, Tiles, Toolbar } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { DataTable, type TableColumn } from "@x-tech-laboratories/x-libs/web/react/table";

import type { OffBudgetItem, TrendMonth, Variance } from "../../shared/budget/model.ts";
import type { BudgetReport } from "../../shared/budget/store.ts";
import { use_data } from "../api.ts";
import { Amount, BudgetPage, use_viewed_month, type BudgetContext, type Money } from "./common.tsx";

// ── Colours ──────────────────────────────────────────────────────────────────

const on_colour = "var(--status-success)";
const off_colour = "var(--status-danger)";

// ── Summary ──────────────────────────────────────────────────────────────────

interface MatrixRow {
  label: string;
  on: number;
  off: number;
  // What the off-budget figure is made of.
  parts: string;
  actual: number;
}

// Kept per column, since money in added to money out means nothing; spending splits exactly, income cannot.
function matrix_rows(report: BudgetReport, money: Money): MatrixRow[] {
  return [
    {
      label: "Income",
      on: report.on_budget_income,
      off: report.off_budget_income,
      parts: `${money.format(report.shortfall)} short · ${money.format(report.surplus)} above plan · ${money.format(report.unbudgeted.income)} unbudgeted`,
      actual: report.income,
    },
    {
      label: "Spending",
      on: report.on_budget_expense,
      off: report.off_budget_expense,
      parts: `${money.format(report.overspent)} over · ${money.format(report.unbudgeted.expense)} unbudgeted`,
      actual: report.spent,
    },
  ];
}

function matrix_columns(money: Money): TableColumn<MatrixRow>[] {
  return [
    { id: "label", label: "", cell: (row) => <strong>{row.label}</strong> },
    { id: "on", label: "On budget", cell: (row) => <span className="tone-good">{money.format(row.on)}</span> },
    {
      id: "off",
      label: "Off budget",
      cell: (row) => (
        <div className="report-figure">
          <span className="tone-bad">{money.format(row.off)}</span>
          <span className="muted small">{row.parts}</span>
        </div>
      ),
    },
    { id: "actual", label: "Actual", cell: (row) => money.format(row.actual) },
  ];
}

function Summary({ report, money }: { report: BudgetReport; money: Money }) {
  const measured = report.on_budget_expense + report.off_budget_expense;
  const within = measured > 0 ? (report.on_budget_expense / measured) * 100 : 0;
  return (
    <>
      <Tiles>
        <Tile label="Income" value={money.format(report.income)} />
        <Tile label="Spent" value={money.format(report.spent)} />
        <Tile label="Balance" value={money.format(report.balance)} tone={report.balance < 0 ? "bad" : "good"} />
        <Tile label="Spent on budget" value={money.format(report.on_budget_expense)} tone="good" />
        <Tile label="Spent off budget" value={money.format(report.off_budget_expense)} tone={report.off_budget_expense > 0 ? "bad" : "none"} />
      </Tiles>
      <DataTable caption="On and off budget" columns={matrix_columns(money)} rows={matrix_rows(report, money)} row_key={(row) => row.label} fill_last_column={false} />
      <Meters
        message="Nothing was spent this month."
        rows={measured > 0 ? [{ label: "Spending within its allocation", href: null, value_text: `${Math.round(within)}%`, percent: within, color: on_colour, marks: [], title: null, behind: { percent: 100, color: off_colour } }] : []}
      />
    </>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

const shown_if = (money: Money, value: number) => (value > 0 ? money.format(value) : "");

function off_budget_columns(money: Money): TableColumn<OffBudgetItem>[] {
  return [
    { id: "label", label: "Line", cell: (item) => item.label },
    { id: "overspent", label: "Overspent", cell: (item) => shown_if(money, item.overspent) },
    { id: "shortfall", label: "Income short", cell: (item) => shown_if(money, item.shortfall) },
    { id: "surplus", label: "Income above plan", cell: (item) => shown_if(money, item.surplus) },
    { id: "total", label: "Total", cell: (item) => <span className="tone-bad">{money.format(item.total)}</span> },
  ];
}

// Variance is signed so that below zero is always off plan: overspent for expenses, short for income.
function variance_columns(money: Money): TableColumn<Variance>[] {
  return [
    { id: "label", label: "Line", sort: (entry) => entry.label, cell: (entry) => entry.label },
    { id: "budgeted", label: "Budgeted", sort: (entry) => entry.budgeted, cell: (entry) => money.format(entry.budgeted) },
    { id: "actual", label: "Actual", sort: (entry) => entry.actual, cell: (entry) => money.format(entry.actual) },
    { id: "variance", label: "Variance", sort: (entry) => entry.variance, cell: (entry) => <Amount value={entry.variance} money={money} /> },
  ];
}

function VarianceTable({ title, entries, money, empty }: { title: string; entries: Variance[]; money: Money; empty: string }) {
  return (
    <Section title={title}>
      {entries.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <DataTable caption={title} columns={variance_columns(money)} rows={entries} row_key={(entry) => entry.id} row_class={(entry) => (entry.off_plan ? "tone-fill-bad" : undefined)} fill_last_column={false} />
      )}
    </Section>
  );
}

// ── Trend ────────────────────────────────────────────────────────────────────

function trend_columns(money: Money, on_month: (month: string) => void): TableColumn<TrendMonth>[] {
  return [
    {
      id: "month",
      label: "Month",
      cell: (entry) => (
        <button type="button" className="link" onClick={() => on_month(entry.month)}>
          {format_month(entry.month, money.locale || undefined)}
        </button>
      ),
    },
    { id: "on", label: "On budget", cell: (entry) => <span className="tone-good">{money.format(entry.on_budget)}</span> },
    { id: "off", label: "Off budget", cell: (entry) => <span className="tone-bad">{money.format(entry.off_budget)}</span> },
    { id: "income", label: "Income", cell: (entry) => money.format(entry.income) },
    { id: "spent", label: "Spent", cell: (entry) => money.format(entry.spent) },
    { id: "balance", label: "Balance", cell: (entry) => <Amount value={entry.balance} money={money} /> },
  ];
}

function Trend({ trend, money, on_month }: { trend: TrendMonth[]; money: Money; on_month: (month: string) => void }) {
  const title = `Last ${trend.length} month${trend.length === 1 ? "" : "s"}`;
  return (
    <Section title={title}>
      <StackedBarChart
        title="Spending on and off budget"
        legend={[["On budget", on_colour], ["Off budget", off_colour]]}
        format={money.format}
        stacks={trend.map((entry) => ({
          label: format_month(entry.month, money.locale || undefined, true),
          parts: [
            { label: "on budget", value: entry.on_budget, color: on_colour },
            { label: "off budget", value: entry.off_budget, color: off_colour },
          ],
        }))}
      />
      <DataTable caption={title} columns={trend_columns(money, on_month)} rows={trend} row_key={(entry) => entry.month} fill_last_column={false} />
    </Section>
  );
}

// ── Report ───────────────────────────────────────────────────────────────────

function MonthReport({ budget, money }: BudgetContext) {
  const [month, set_month] = use_viewed_month();
  const report = use_data((api) => api.get_budget_report(budget.id, month), [budget.id, month]);

  return (
    <div className="stack">
      <Toolbar>
        <PeriodStepper label="Month" period="month" value={month} on_change={set_month} locale={money.locale || undefined} />
      </Toolbar>
      <Loaded resource={report}>
        {(loaded) => (
          <>
            <Summary report={loaded} money={money} />
            <Section title="What went off budget">
              {loaded.off_budget.length === 0 ? (
                <p className="muted">Everything this month went to plan.</p>
              ) : (
                <DataTable caption="What went off budget" columns={off_budget_columns(money)} rows={loaded.off_budget} row_key={(item) => item.id} fill_last_column={false} />
              )}
            </Section>
            <VarianceTable title="Expenses: budgeted and actual" entries={loaded.expense_variance} money={money} empty="No expense lines yet." />
            <VarianceTable title="Income: budgeted and actual" entries={loaded.income_variance} money={money} empty="No income lines yet." />
            <Section title="Income this month">
              {loaded.income_transactions.length === 0 ? (
                <p className="muted">No income recorded this month.</p>
              ) : (
                <DataTable
                  caption="Income this month"
                  columns={[
                    { id: "date", label: "Date", cell: (transaction) => transaction.date },
                    { id: "description", label: "Description", cell: (transaction) => transaction.description || "Untitled" },
                    { id: "amount", label: "Amount", cell: (transaction) => money.format(transaction.income) },
                  ]}
                  rows={loaded.income_transactions}
                  row_key={(transaction) => transaction.id}
                  fill_last_column={false}
                />
              )}
            </Section>
            <Trend trend={loaded.trend} money={money} on_month={set_month} />
          </>
        )}
      </Loaded>
    </div>
  );
}

export function ReportView() {
  return (
    <BudgetPage title="Report" subtitle="How the month measured up against the plan.">
      {(context) => <MonthReport {...context} />}
    </BudgetPage>
  );
}
