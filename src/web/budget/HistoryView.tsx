// The history of a budget's lines and transactions: every version of one item in a dialog opened from it, and the latest
// changes to the whole budget on a page of their own, each version restorable.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Dialog, open_dialog } from "@x-tech-laboratories/x-libs/web/react/dialog";
import { Loaded } from "@x-tech-laboratories/x-libs/web/react/states";
import { DataTable, type TableColumn } from "@x-tech-laboratories/x-libs/web/react/table";
import { Age } from "@x-tech-laboratories/x-libs/web/react/time";

import type { BudgetVersion } from "../../shared/budget/history.ts";
import { line_title } from "../../shared/budget/model.ts";
import { calls, use_data } from "../api.ts";
import { attempt, BudgetPage, type BudgetContext, type Money } from "./common.tsx";

// ── Words ────────────────────────────────────────────────────────────────────

const kind_words = { first_seen: "Already there", created: "Added", edited: "Changed", deleted: "Deleted", restored: "Restored" } as const;

// What the item held in this version, such as "Rent · expense $1,200.00".
function describe_version(version: BudgetVersion, money: Money): string {
  const amounts = (income: number, expense: number) =>
    [income !== 0 && `income ${money.format(income)}`, expense !== 0 && `expense ${money.format(expense)}`].filter(Boolean).join(", ") || "no amounts";
  if (version.item === "line") return `${line_title(version.snapshot)} · ${amounts(version.snapshot.income, version.snapshot.expense)}`;
  const { date, description, income, expense } = version.snapshot;
  return `${date} ${description || "Untitled"} · ${amounts(income, expense)}`;
}

function restore(version: BudgetVersion): void {
  attempt(version.item === "line" ? calls().restore_line_version(version.id) : calls().restore_transaction_version(version.id));
}

// ── Table ────────────────────────────────────────────────────────────────────

interface VersionRow {
  version: BudgetVersion;
  money: Money;
  // The newest version of an item that still exists is what it holds now, so it cannot be restored.
  is_current: boolean;
}

const columns: TableColumn<VersionRow>[] = [
  { id: "when", label: "When", cell: ({ version }) => <Age epoch={Date.parse(version.changed_at) / 1000} /> },
  { id: "kind", label: "Change", cell: ({ version }) => `${kind_words[version.kind]}${version.origin === "elsewhere" ? " on another device" : ""}` },
  { id: "item", label: "What", cell: ({ version, money }) => `${version.item === "line" ? "Line" : "Transaction"}: ${describe_version(version, money)}` },
  {
    id: "restore",
    label: "Restore",
    header: "",
    hideable: false,
    cell: ({ version, is_current }) =>
      is_current ? <span className="muted">Current</span> : <button type="button" onClick={() => restore(version)}>{version.kind === "deleted" ? "Bring back" : "Restore"}</button>,
  },
];

function version_rows(versions: BudgetVersion[], money: Money): VersionRow[] {
  const newest = new Set<string>();
  return versions.map((version) => {
    const is_newest = !newest.has(version.item_id);
    newest.add(version.item_id);
    return { version, money, is_current: is_newest && version.kind !== "deleted" };
  });
}

function VersionsTable({ caption, versions, money }: { caption: string; versions: BudgetVersion[]; money: Money }) {
  if (versions.length === 0) return <p className="muted">No changes yet.</p>;
  return <DataTable caption={caption} columns={columns} rows={version_rows(versions, money)} row_key={(row) => row.version.id} fill_last_column={false} />;
}

// ── One item ─────────────────────────────────────────────────────────────────

function ItemVersions({ item, id, money }: { item: BudgetVersion["item"]; id: string; money: Money }) {
  const versions = use_data<BudgetVersion[]>((api) => (item === "line" ? api.list_line_versions(id) : api.list_transaction_versions(id)), [item, id]);
  return <Loaded resource={versions}>{(listed) => <VersionsTable caption="Versions" versions={listed} money={money} />}</Loaded>;
}

// Every version of one line or transaction, newest first.
export function open_versions(item: BudgetVersion["item"], id: string, name: string, money: Money): void {
  open_dialog((close) => (
    <Dialog title={`History of ${name}`} on_close={close} wide>
      <ItemVersions item={item} id={id} money={money} />
    </Dialog>
  ));
}

// ── Page ─────────────────────────────────────────────────────────────────────

const recent_count = 100;

function BudgetChanges({ budget, money }: BudgetContext) {
  const changes = use_data((api) => api.list_budget_changes(budget.id, recent_count), [budget.id]);
  return <Loaded resource={changes}>{(listed) => <VersionsTable caption={`Changes to ${budget.name}`} versions={listed} money={money} />}</Loaded>;
}

export function HistoryView() {
  return (
    <BudgetPage title="History" subtitle={`The latest ${recent_count} changes to the budget's lines and transactions, on every device.`}>
      {(context) => <BudgetChanges {...context} />}
    </BudgetPage>
  );
}
