// What the Plan, Transactions and Report pages share: the budget this device is viewing, the month Transactions and
// Report both show, and amounts in the currency chosen under Settings.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import { this_month } from "@x-tech-laboratories/x-libs/dates";
import { format_money, money_decimals, money_step } from "@x-tech-laboratories/x-libs/money";
import { Select } from "@x-tech-laboratories/x-libs/web/react/controls";
import { PageHeading } from "@x-tech-laboratories/x-libs/web/react/layout";
import { use_pref } from "@x-tech-laboratories/x-libs/web/react/prefs";
import { Empty, Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { create_store, use_store } from "@x-tech-laboratories/x-libs/web/react/store";
import { toast } from "@x-tech-laboratories/x-libs/web/react/toasts";
import { describe_error } from "@x-tech-laboratories/x-libs/web/errors";

import type { BudgetSummary } from "../../shared/budget/store.ts";
import { use_data, use_settings } from "../api.ts";

// ── Money ────────────────────────────────────────────────────────────────────

export interface Money {
  currency: string;
  locale: string;
  decimals: number;
  // How far an amount field steps, such as 0.01.
  step: number;
  format: (value: number) => string;
}

export function money_of(settings: Record<string, unknown>): Money {
  const currency = String(settings.currency || "USD");
  const locale = String(settings.locale ?? "");
  const decimals = money_decimals(settings.decimals);
  return { currency, locale, decimals, step: money_step(decimals), format: (value) => format_money(value, { currency, locale, decimals }) };
}

// A figure below zero reads in the danger colour.
export function Amount({ value, money }: { value: number; money: Money }) {
  return <span className={value < 0 ? "amount tone-bad" : "amount"}>{money.format(value)}</span>;
}

// A call made from a button or field, its failure shown as a toast rather than lost.
export function attempt(work: Promise<unknown>): void {
  work.catch((error: unknown) => toast(describe_error(error), { tone: "bad" }));
}

// ── Month ────────────────────────────────────────────────────────────────────

// Empty until a month is picked, so the page opens on the month it is when first drawn.
const viewed_month = create_store<string | null>(null);

// Transactions and Report keep the same month while moving between them.
export function use_viewed_month(): [string, (month: string) => void] {
  return [use_store(viewed_month) ?? this_month(), (month) => viewed_month.set(month)];
}

// ── Budget ───────────────────────────────────────────────────────────────────

export interface BudgetContext {
  budget: BudgetSummary;
  money: Money;
  settings: Record<string, unknown>;
}

const budget_pref = "x-budget-budget";

// The budget this device views, or the first when the one remembered is gone.
function chosen_budget(budgets: BudgetSummary[], chosen_id: string): BudgetSummary | undefined {
  return budgets.find((budget) => budget.id === chosen_id) ?? budgets[0];
}

interface BudgetPageProps {
  title: string;
  subtitle: string;
  children: (context: BudgetContext) => ReactNode;
}

// A page about one budget: its heading, a choice of budget when there are several, and the page once all is loaded.
export function BudgetPage({ title, subtitle, children }: BudgetPageProps) {
  const settings = use_settings();
  const budgets = use_data((api) => api.list_budgets());
  const [chosen_id, choose] = use_pref(budget_pref, "main", (value): value is string => typeof value === "string");
  const listed = budgets.data ?? [];
  const budget = chosen_budget(listed, chosen_id);

  const picker = listed.length > 1 && budget && (
    <Select label="Budget" bare options={listed.map((each) => [each.id, each.name] as [string, string])} value={budget.id} on_change={choose} />
  );

  return (
    <>
      <PageHeading title={title} subtitle={subtitle} actions={picker || undefined} />
      <Loaded resource={settings}>
        {(values) => (
          <Loaded resource={budgets}>
            {(list) => {
              const current = chosen_budget(list, chosen_id);
              if (!current) return <Empty title="No budgets" hint="Add one under Settings → Plan → Budgets." />;
              return children({ budget: current, money: money_of(values), settings: values });
            }}
          </Loaded>
        )}
      </Loaded>
    </>
  );
}
