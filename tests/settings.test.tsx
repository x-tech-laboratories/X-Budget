// @vitest-environment jsdom
import "@x-tech-laboratories/x-libs/web/react/test_stubs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { set_page_api } from "@x-tech-laboratories/x-libs/app/web/page";
import { SettingsView } from "@x-tech-laboratories/x-libs/app/web/settings_page";

import { app, type BudgetMethods } from "../src/app.ts";
import { pages } from "../src/web/pages.tsx";
import { money_settings } from "../src/web/settings/money.tsx";

afterEach(cleanup);

function fake_calls(saved: Record<string, unknown>): Client<BudgetMethods> {
  return {
    get_settings: vi.fn(async () => ({ ...saved })),
    list_budgets: vi.fn(async () => [{ id: "main", name: "Budget", position: 0, lines: 0, transactions: 0 }]),
    set_setting: vi.fn(async (key: string, value: unknown) => {
      saved[key] = value;
    }),
  } as unknown as Client<BudgetMethods>;
}

describe("settings", () => {
  it("shows how money is written and saves a new currency", async () => {
    const calls = fake_calls({ locale: "en-US", decimals: 0 });
    set_page_api({ host: "web", calls, device: null, backups: null, on_change: () => () => undefined });
    render(<SettingsView pages={{ app, pages, general_settings: money_settings }} />);

    expect(await screen.findByText("Amounts look like -$1,235.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "JMD" } });

    await waitFor(() => expect(calls.set_setting).toHaveBeenCalledWith("currency", "JMD"));
  });

  it("saves a locale and decimal places", async () => {
    const calls = fake_calls({ locale: "en-US", decimals: 2 });
    set_page_api({ host: "web", calls, device: null, backups: null, on_change: () => () => undefined });
    render(<SettingsView pages={{ app, pages, general_settings: money_settings }} />);

    const locale = await screen.findByPlaceholderText("This device's");
    fireEvent.change(locale, { target: { value: "en-JM" } });
    fireEvent.blur(locale);

    await waitFor(() => expect(calls.set_setting).toHaveBeenCalledWith("locale", "en-JM"));
  });
});
