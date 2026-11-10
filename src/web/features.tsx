// The sections of the app, each a page with its own settings, in the order the sidebar lists them.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import type { SettingsSection } from "@x-tech-laboratories/x-libs/web/react/layout";

import { history_settings, plan_settings, report_settings } from "./budget/BudgetSettings.tsx";
import { HistoryView } from "./budget/HistoryView.tsx";
import { PlanView } from "./budget/PlanView.tsx";
import { ReportView } from "./budget/ReportView.tsx";
import { TransactionsView } from "./budget/TransactionsView.tsx";

// ── Features ─────────────────────────────────────────────────────────────────

export interface FeatureSettingsProps {
  settings: Record<string, unknown>;
  set_setting: (key: string, value: unknown) => Promise<void>;
}

export interface PageFeature {
  // The route's first part, such as "plan" for #/plan.
  id: string;
  label: string;
  view: (parts: string[]) => ReactNode;
  settings: (props: FeatureSettingsProps) => SettingsSection[];
}

export const page_features: PageFeature[] = [
  { id: "plan", label: "Plan", view: () => <PlanView />, settings: plan_settings },
  { id: "transactions", label: "Transactions", view: () => <TransactionsView />, settings: () => [] },
  { id: "report", label: "Report", view: () => <ReportView />, settings: report_settings },
  { id: "history", label: "History", view: () => <HistoryView />, settings: history_settings },
];
