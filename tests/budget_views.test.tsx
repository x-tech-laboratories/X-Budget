// @vitest-environment jsdom
import "@x-tech-laboratories/x-libs/web/react/test_stubs";
import { DatabaseSync } from "node:sqlite";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { Dialogs } from "@x-tech-laboratories/x-libs/web/react/dialog";
import { ContextMenus } from "@x-tech-laboratories/x-libs/web/react/menus";

import { bind_methods, open_store, type BudgetMethods } from "../src/shared/store.ts";
import { data_watch, set_page_api } from "../src/web/api.ts";
import { PlanView } from "../src/web/budget/PlanView.tsx";
import { HistoryView } from "../src/web/budget/HistoryView.tsx";
import { ReportView } from "../src/web/budget/ReportView.tsx";
import { TransactionsView } from "../src/web/budget/TransactionsView.tsx";

// The page's calls answered by a real store on a throwaway database, as a host would, each write telling the views.
function fake_page(): BudgetMethods {
  const database = new DatabaseSync(":memory:");
  open_store(database);
  const methods = bind_methods(() => database, () => undefined);
  const calls = Object.fromEntries(Object.entries(methods).map(([name, call]) => [name, async (...args: unknown[]) => (call as (...args: unknown[]) => unknown)(...args)]));
  set_page_api({ host: "web", calls: calls as unknown as Client<BudgetMethods>, device: null, backups: null, on_change: () => () => undefined });
  methods.set_setting("locale", "en-US");
  return methods;
}

function show(view: React.ReactNode) {
  return render(<>{view}<Dialogs /><ContextMenus /></>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("plan", () => {
  it("adds a line, saves its title and amount, and totals the plan", async () => {
    const store = fake_page();
    show(<PlanView />);

    fireEvent.click(await screen.findByRole("button", { name: "Add line" }));
    const title = await screen.findByRole("textbox", { name: "Line" });
    fireEvent.change(title, { target: { value: "Rent" } });
    fireEvent.blur(title);
    await waitFor(() => expect(store.get_budget_plan("main").lines[0]!.title).toBe("Rent"));

    const expense = await screen.findByRole("textbox", { name: "Rent expense" });
    fireEvent.change(expense, { target: { value: "1200" } });
    fireEvent.blur(expense);
    await waitFor(() => expect(screen.getByText("Planned spending").parentElement!.textContent).toContain("$1,200.00"));
    expect(screen.getByText("Planned balance").parentElement!.textContent).toContain("-$1,200.00");
  });

  it("shows a computed parent's sum read-only and moves a line out of its parent with Alt and the left arrow", async () => {
    const store = fake_page();
    const housing = store.add_budget_line("main", null);
    store.update_budget_line(housing, { title: "Housing" });
    const rent = store.add_budget_line("main", housing);
    store.update_budget_line(rent, { title: "Rent", expense: 1200 });
    show(<PlanView />);

    expect(await screen.findByRole("textbox", { name: "Rent expense" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Housing expense" })).toBeNull();

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rent expense" }), { key: "ArrowLeft", altKey: true });
    await waitFor(() => expect(store.get_budget_plan("main").lines.find((line) => line.id === rent)!.parent_id).toBeNull());
  });

  it("asks before deleting a line with lines under it", async () => {
    const store = fake_page();
    const housing = store.add_budget_line("main", null);
    store.update_budget_line(housing, { title: "Housing" });
    store.add_budget_line("main", housing);
    show(<PlanView />);

    fireEvent.click(await screen.findByRole("button", { name: "Housing actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("the 1 line(s) under it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(store.get_budget_plan("main").lines).toEqual([]));
  });
});

describe("transactions", () => {
  it("adds a transaction to the month on screen and charges it to a line by its path", async () => {
    const store = fake_page();
    const housing = store.add_budget_line("main", null);
    store.update_budget_line(housing, { title: "Housing" });
    const rent = store.add_budget_line("main", housing);
    store.update_budget_line(rent, { title: "Rent", expense: 1200 });
    show(<TransactionsView />);

    fireEvent.click(await screen.findByRole("button", { name: "Previous month" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(store.list_budget_transactions("main", "2026-07").map((transaction) => transaction.date)).toEqual(["2026-07-01"]));

    const line = await screen.findByRole("combobox", { name: "Transaction line" });
    fireEvent.change(line, { target: { value: rent } });
    await waitFor(() => expect(store.list_budget_transactions("main", "2026-07")[0]!.line_id).toBe(rent));
    expect(within(line).getByRole("option", { name: /Housing › Rent/ })).toBeTruthy();
  });

  it("files a new transaction under today in this month and totals the month", async () => {
    const store = fake_page();
    const earned = store.add_budget_transaction("main", "2026-08-01");
    store.update_budget_transaction(earned, { description: "Pay", income: 3000 });
    show(<TransactionsView />);

    fireEvent.click(await screen.findByRole("button", { name: "This month" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add transaction" }));
    await waitFor(() => expect(store.list_budget_transactions("main", "2026-08").map((transaction) => transaction.date)).toEqual(["2026-08-01", "2026-08-15"]));
    expect(screen.getByText("Balance", { selector: ".tile-label" }).parentElement!.textContent).toContain("$3,000.00");
  });
});

describe("report", () => {
  it("measures the month on and off budget and lists what went off", async () => {
    const store = fake_page();
    const food = store.add_budget_line("main", null);
    store.update_budget_line(food, { title: "Food", expense: 400 });
    const lunch = store.add_budget_transaction("main", "2026-08-02");
    store.update_budget_transaction(lunch, { expense: 450, line_id: food });
    const concert = store.add_budget_transaction("main", "2026-08-03");
    store.update_budget_transaction(concert, { expense: 85 });
    data_watch.bump();
    show(<ReportView />);

    expect((await screen.findByText("Spent off budget")).parentElement!.textContent).toContain("$135.00");
    expect(screen.getByText("Spent on budget").parentElement!.textContent).toContain("$400.00");
    const off = screen.getByRole("table", { name: "What went off budget" });
    expect(within(off).getByText("Food")).toBeTruthy();
    expect(within(off).getByText("Unbudgeted spending")).toBeTruthy();
    expect(screen.getByRole("meter", { name: "Spending within its allocation" }).getAttribute("aria-valuetext")).toBe("75%");
  });
});

describe("history", () => {
  it("brings a deleted line back from the History page", async () => {
    const store = fake_page();
    const rent = store.add_budget_line("main", null);
    store.update_budget_line(rent, { title: "Rent", expense: 1200 });
    store.delete_budget_line(rent);
    show(<HistoryView />);

    const table = await screen.findByRole("table", { name: "Changes to Budget" });
    expect(within(table).getAllByText(/Line: Rent · expense \$1,200\.00/).length).toBeGreaterThan(0);
    fireEvent.click(within(table).getByRole("button", { name: "Bring back" }));
    await waitFor(() => expect(store.get_budget_plan("main").lines.map((line) => line.title)).toEqual(["Rent"]));
  });

  it("shows a transaction's versions from its row and restores an older one", async () => {
    const store = fake_page();
    const lunch = store.add_budget_transaction("main", "2026-08-02");
    store.update_budget_transaction(lunch, { description: "Lunch", expense: 12 });
    store.update_budget_transaction(lunch, { expense: 120 });
    show(<TransactionsView />);

    fireEvent.click(await screen.findByRole("button", { name: "History of Lunch" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Current")).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Restore" })[0]!);
    await waitFor(() => expect(store.list_budget_transactions("main", "2026-08")[0]!.expense).toBe(12));
  });
});
