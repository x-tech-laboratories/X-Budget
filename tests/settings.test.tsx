// @vitest-environment jsdom
import "@x-tech-laboratories/x-libs/web/react/test_stubs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";

import type { DeviceMethods } from "../src/shared/bridge.ts";
import type { BudgetMethods } from "../src/shared/store.ts";
import { set_page_api } from "../src/web/api.ts";
import { SettingsView } from "../src/web/settings/SettingsView.tsx";

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

const off = { state: "off", server_url: "", last_synced_at: "", pending_changes: 0, error: "" } as const;

describe("settings", () => {
  it("shows how money is written and saves a new currency", async () => {
    const calls = fake_calls({ locale: "en-US", decimals: 0 });
    set_page_api({ host: "web", calls, device: null, on_change: () => () => undefined });
    render(<SettingsView />);

    expect(await screen.findByText("Amounts look like -$1,235.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "JMD" } });
    await waitFor(() => expect(calls.set_setting).toHaveBeenCalledWith("currency", "JMD"));
    expect(screen.queryByText("Sync")).toBeNull();
  });

  it("offers sync on a device and connects with the choice of copy", async () => {
    const device = {
      get_sync_status: vi.fn(async () => off),
      connect_sync: vi.fn(async () => ({ ...off, state: "idle", server_url: "https://budget.example.org/" })),
      disconnect_sync: vi.fn(),
      sync_now: vi.fn(),
    } as unknown as Client<DeviceMethods>;
    set_page_api({ host: "desktop", calls: fake_calls({}), device, on_change: () => () => undefined });
    render(<SettingsView />);

    fireEvent.change(await screen.findByLabelText("Server address"), { target: { value: "https://budget.example.org" } });
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Use the server's data" }));
    await waitFor(() => expect(device.connect_sync).toHaveBeenCalledWith("https://budget.example.org", "secret", "download"));
  });
});
