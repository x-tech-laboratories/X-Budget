// @vitest-environment jsdom
import "@x-tech-laboratories/x-libs/web/react/test_stubs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";

import type { BackupClient } from "@x-tech-laboratories/x-libs/backups";
import type { SyncDeviceClient } from "@x-tech-laboratories/x-libs/sync_protocol";
import { Dialogs } from "@x-tech-laboratories/x-libs/web/react/dialog";
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

const off = { state: "off", server_url: "", user: "", last_synced_at: "", pending_changes: 0, error: "" } as const;

describe("settings", () => {
  it("shows how money is written and saves a new currency", async () => {
    const calls = fake_calls({ locale: "en-US", decimals: 0 });
    set_page_api({ host: "web", calls, device: null, backups: null, on_change: () => () => undefined });
    render(<SettingsView />);

    expect(await screen.findByText("Amounts look like -$1,235.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Currency" }), { target: { value: "JMD" } });
    await waitFor(() => expect(calls.set_setting).toHaveBeenCalledWith("currency", "JMD"));
    expect(screen.queryByText("Sync")).toBeNull();
  });

  it("offers sync on a device and signs in with the choice of copy once confirmed", async () => {
    const device = {
      get_sync_status: vi.fn(async () => off),
      connect_sync: vi.fn(async () => ({ ...off, state: "idle", server_url: "https://budget.example.org/", user: "admin" })),
      disconnect_sync: vi.fn(),
      sync_now: vi.fn(),
    } as unknown as SyncDeviceClient;
    set_page_api({ host: "desktop", calls: fake_calls({}), device, backups: null, on_change: () => () => undefined });
    render(<><SettingsView /><Dialogs /></>);

    fireEvent.change(await screen.findByLabelText("Server address"), { target: { value: "https://budget.example.org" } });
    fireEvent.change(screen.getByLabelText("User name"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "made-up password" } });
    fireEvent.click(screen.getByRole("button", { name: "Use the server's budgets" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use the server's" }));
    await waitFor(() => expect(device.connect_sync).toHaveBeenCalledWith("https://budget.example.org", expect.objectContaining({ name: "admin", password: "made-up password" }), "download"));
  });

  it("asks a phone for a backup folder before it backs up, and lists backups once one is picked", async () => {
    const off = { state: "off", server_url: "", user: "", last_synced_at: "", pending_changes: 0, error: "" } as const;
    const device = { get_sync_status: vi.fn(async () => off), connect_sync: vi.fn(), disconnect_sync: vi.fn(), sync_now: vi.fn() } as unknown as SyncDeviceClient;
    const backups = {
      list_backups: vi.fn(async () => []),
      create_backup: vi.fn(),
      restore_backup: vi.fn(),
      remove_backup: vi.fn(),
      get_backup_schedule: vi.fn(async () => ({ automatic: true, to_keep: 14 })),
      set_backup_schedule: vi.fn(),
    } as unknown as BackupClient;
    let folder = "";
    const backup_folder = { name: vi.fn(async () => folder), choose: vi.fn(async () => (folder = "Documents")) };
    set_page_api({ host: "android", calls: fake_calls({}), device, backups, backup_folder, on_change: () => () => undefined });
    render(<><SettingsView /><Dialogs /></>);

    fireEvent.click(await screen.findByRole("button", { name: "Choose folder…" }));
    expect(await screen.findByText("Documents")).toBeTruthy();
    expect(backup_folder.choose).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Change folder…" })).toBeTruthy();
    await waitFor(() => expect(backups.list_backups).toHaveBeenCalled());
  });
});
