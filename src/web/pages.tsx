// The sections of the app, each a page with its own settings, in the order the sidebar lists them.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { AppPage } from "@x-tech-laboratories/x-app/app/web/app_page";

import { history_settings, plan_settings, report_settings } from "./budget/BudgetSettings.tsx";
import { HistoryView } from "./budget/HistoryView.tsx";
import { PlanView } from "./budget/PlanView.tsx";
import { ReportView } from "./budget/ReportView.tsx";
import { TransactionsView } from "./budget/TransactionsView.tsx";

// ── Pages ────────────────────────────────────────────────────────────────────

export const pages: AppPage[] = [
  { id: "plan", label: "Plan", view: () => <PlanView />, settings: plan_settings },
  { id: "transactions", label: "Transactions", view: () => <TransactionsView /> },
  { id: "report", label: "Report", view: () => <ReportView />, settings: report_settings },
  { id: "history", label: "History", view: () => <HistoryView />, settings: history_settings },
];
