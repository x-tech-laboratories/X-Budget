// X-Budget as the base app runs it: its name, ports and files, the money settings every part shares, and the budget.

// ── Imports ──────────────────────────────────────────────────────────────────

import { define_app, type AppMethodsOf } from "@x-tech-laboratories/x-app/app/define";
import { settings_of } from "@x-tech-laboratories/x-app/settings";

import package_json from "../package.json" with { type: "json" };
import { budget_feature } from "./shared/budget/store.ts";

// ── Settings ─────────────────────────────────────────────────────────────────

export const money_setting_defaults = {
  // An ISO 4217 code such as "USD" or "JMD".
  currency: "USD",
  // A locale such as "en-US"; empty uses the reader's own.
  locale: "",
  // Places amounts are kept and shown with; 0 budgets in whole units.
  decimals: 2,
};

// ── App ──────────────────────────────────────────────────────────────────────

export const app = define_app({
  id: "x-budget",
  name: "X-Budget",
  env_prefix: "X_BUDGET",
  version: package_json.version,
  summary: "Serves X-Budget as a web app and syncs its devices.",
  instructions: [
    "X-Budget holds budgets: each a tree of planned income and expense lines, and a ledger of the transactions that actually moved, measured month by month against the plan.",
    "Days are local dates such as 2026-11-10 and months such as 2026-11; amounts are in the currency get_settings gives, rounded to its decimal places.",
    'Start with list_budgets (every device has the budget "main"), then get_budget_plan, list_budget_transactions and get_budget_report.',
  ].join(" "),
  data_name: "budgets",
  database_file: "budget.db",
  backup_prefix: "budget",
  ports: { server: 7740, peer: 7741 },
  server_example: "https://budget.example.org",
  features: [budget_feature],
  settings: settings_of(money_setting_defaults),
  settings_descriptions: {
    get_settings: "Every setting by key, such as currency, decimals and budget.rollup_mode, the ones never set at their defaults.",
    set_setting: "Sets one setting, such as currency to JMD or budget.rollup_mode to cap.",
  },
  setting_key_example: "currency",
});

// Every call the page can make, as it makes them.
export type BudgetMethods = AppMethodsOf<typeof app>;
