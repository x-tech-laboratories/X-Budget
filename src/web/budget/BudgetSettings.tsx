// The budget's settings: how parent lines add up, the budgets themselves with their files, and how far back the trend
// reaches.

// ── Imports ──────────────────────────────────────────────────────────────────

import { useRef, useState } from "react";
import { CommitInput, NumberField, Select } from "@x-tech-laboratories/x-libs/web/react/controls";
import { confirm_dialog } from "@x-tech-laboratories/x-libs/web/react/dialog";
import { SettingRow, type SettingsSection } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { toast } from "@x-tech-laboratories/x-libs/web/react/toasts";

import { is_rollup_mode, type RollupMode } from "../../shared/budget/model.ts";
import type { BudgetSummary } from "../../shared/budget/store.ts";
import { calls, use_data } from "../api.ts";
import type { FeatureSettingsProps } from "../features.tsx";
import { attempt } from "./common.tsx";

// ── Parent totals ────────────────────────────────────────────────────────────

const mode_options: [RollupMode, string][] = [
  ["computed", "Computed: a parent is the sum of its lines"],
  ["additive", "Own and lines: a parent's own amounts are added to its lines'"],
  ["cap", "Cap: a parent is an allocation its lines draw on"],
];

function ParentTotals({ settings, set_setting }: FeatureSettingsProps) {
  const mode = is_rollup_mode(settings["budget.rollup_mode"]) ? settings["budget.rollup_mode"] : "computed";
  return (
    <SettingRow label="Parent lines" hint="Applies to income and expense apart, and to the plan and the report alike. Switching reads the same budget a new way; nothing typed changes.">
      <Select label="Parent lines" bare options={mode_options} value={mode} on_change={(value) => void set_setting("budget.rollup_mode", value)} />
    </SettingRow>
  );
}

// ── Budgets ──────────────────────────────────────────────────────────────────

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function delete_budget(budget: BudgetSummary): void {
  confirm_dialog({
    title: `Delete ${budget.name}?`,
    message: `Its ${budget.lines} line(s) and ${budget.transactions} transaction(s) go with it. Export it first to keep a copy.`,
    confirm_label: "Delete budget",
    danger: true,
    type_to_confirm: budget.name,
    run: async () => void (await calls().delete_budget(budget.id)),
  });
}

function BudgetRow({ budget }: { budget: BudgetSummary }) {
  return (
    <SettingRow label={<CommitInput type="text" aria-label="Budget name" value={budget.name} on_commit={(event) => event.currentTarget.value !== budget.name && attempt(calls().rename_budget(budget.id, event.currentTarget.value))} />} hint={`${budget.lines} line(s), ${budget.transactions} transaction(s)`}>
      <button type="button" onClick={() => attempt(calls().export_budget(budget.id).then((text) => download(`${budget.name}.json`, text)))}>Export JSON</button>
      <button type="button" className="remove" onClick={() => delete_budget(budget)}>Delete</button>
    </SettingRow>
  );
}

// A file always becomes a new budget named after it, so importing never replaces one already here.
function Budgets() {
  const budgets = use_data((api) => api.list_budgets());
  const picker = useRef<HTMLInputElement>(null);
  const [busy, set_busy] = useState(false);

  async function import_file(file: File): Promise<void> {
    set_busy(true);
    try {
      const result = await calls().import_budget(file.name.replace(/\.json$/i, ""), await file.text());
      const skipped = result.skipped > 0 ? ` ${result.skipped} without a date were left out.` : "";
      toast(`Imported ${result.lines} line(s) and ${result.transactions} transaction(s).${skipped}`, { tone: "good" });
    } catch (error) {
      toast(`Could not import: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" });
    } finally {
      set_busy(false);
    }
  }

  return (
    <Loaded resource={budgets}>
      {(listed) => (
        <>
          {listed.map((budget) => <BudgetRow key={budget.id} budget={budget} />)}
          <SettingRow label="Add" hint="A JSON file from the Trilium Budget add-on, or one exported here, becomes a new budget.">
            <button type="button" onClick={() => attempt(calls().add_budget("New budget"))}>New budget</button>
            <input
              ref={picker}
              type="file"
              accept="application/json,.json"
              aria-label="Budget file"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void import_file(file);
              }}
            />
            <button type="button" disabled={busy} onClick={() => picker.current?.click()}>{busy ? "Importing…" : "Import JSON…"}</button>
          </SettingRow>
        </>
      )}
    </Loaded>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

export function plan_settings(props: FeatureSettingsProps): SettingsSection[] {
  return [
    { id: "parent-lines", heading: "Parent lines", hint: "How a line with lines under it adds up.", content: <ParentTotals {...props} /> },
    { id: "budgets", heading: "Budgets", hint: "Each budget keeps its own plan and transactions.", content: <Budgets /> },
  ];
}

export function report_settings({ settings, set_setting }: FeatureSettingsProps): SettingsSection[] {
  const months = Number(settings["budget.trend_months"]) || 6;
  return [
    {
      id: "trend",
      heading: "Trend",
      content: (
        <SettingRow label="Months shown" hint="How many months the trend covers, ending with the month viewed.">
          <NumberField bare label="Months shown" value={months} min={1} max={36} on_change={(value) => value && value !== months && void set_setting("budget.trend_months", Math.round(value))} />
        </SettingRow>
      ),
    },
  ];
}
