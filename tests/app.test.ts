import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { app } from "../src/app.ts";

describe("X-Budget's app", () => {
  it("keeps the money settings, the budget's own and the base's, each at its default", () => {
    expect(app.setting_defaults).toMatchObject({ currency: "USD", locale: "", decimals: 2, "budget.rollup_mode": "computed", history_days: 365 });
  });

  it("starts every device with the main budget", () => {
    const database = new DatabaseSync(":memory:");
    app.open_store(database);

    expect(app.bind_methods(() => database, () => undefined).list_budgets()).toEqual([expect.objectContaining({ id: "main" })]);
  });

  it("keeps the names the desktop app's page and older backups already use", () => {
    expect(app.bridges.calls.api_name).toBe("x_budget");
    expect(app.bridges.events.api_name).toBe("x_budget_events");
    expect(app.backup_naming.name_for(new Date("2026-06-10T09:30:00Z"), true)).toMatch(/^budget-2026-06-10T09-30-00Z-auto\.db$/);
  });
});
