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

const off = { state: "off", device: "d1", name: "This device", addresses: [], peers: [], last_synced_at: "", pending_changes: 0, error: "" } as const;

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

  it("offers sync on a device and pairs with another device's code", async () => {
    const device = {
      get_sync_status: vi.fn(async () => off),
      create_pairing_code: vi.fn(async () => ({ code: "123-456", expires_at: "2099-01-01T00:00:00Z" })),
      pair_device: vi.fn(async () => off),
      remove_device: vi.fn(async () => off),
      sync_now: vi.fn(async () => off),
    } as unknown as SyncDeviceClient;
    set_page_api({ host: "desktop", calls: fake_calls({}), device, backups: null, on_change: () => () => undefined });
    render(<><SettingsView /><Dialogs /></>);

    expect((await screen.findAllByText("Sync")).length).toBeGreaterThan(0);
    await waitFor(() => expect(device.get_sync_status).toHaveBeenCalled());
  });

  it("shows the server's sync to an admin in a browser, and not to anyone else", async () => {
    const device = { get_sync_status: vi.fn(async () => off), create_pairing_code: vi.fn(), pair_device: vi.fn(), remove_device: vi.fn(), sync_now: vi.fn() } as unknown as SyncDeviceClient;
    set_page_api({ host: "web", calls: fake_calls({}), device, backups: null, on_change: () => () => undefined });
    const { unmount } = render(<SettingsView is_admin={false} />);
    expect((await screen.findAllByText("Money")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Keep the server's budgets alike with the devices paired with it.")).toBeNull();
    unmount();

    render(<SettingsView is_admin />);
    expect(await screen.findByText("Keep the server's budgets alike with the devices paired with it.")).toBeTruthy();
  });

  it("lists the daemons a desktop window can work on, and its own settings", async () => {
    const view = { connections: [{ id: "local", name: "This computer", kind: "local" as const, address: "", user: "" }], current: "local" };
    const connections = { list_connections: vi.fn(async () => view), add_connection: vi.fn(), rename_connection: vi.fn(), remove_connection: vi.fn(), choose_connection: vi.fn() };
    const desktop = {
      get_desktop_settings: vi.fn(async () => ({ keep_running_in_background: true, start_at_login: true })),
      set_desktop_setting: vi.fn(async () => undefined),
      quit_completely: vi.fn(async () => undefined),
    };
    set_page_api({ host: "desktop", calls: fake_calls({}), device: null, backups: null, connections, desktop, on_change: () => () => undefined });
    render(<><SettingsView /><Dialogs /></>);

    expect(await screen.findByText("This computer")).toBeTruthy();
    fireEvent.click(await screen.findByRole("switch", { name: "Keep running in the background" }));
    await waitFor(() => expect(desktop.set_desktop_setting).toHaveBeenCalledWith("keep_running_in_background", false));
  });

  it("asks a phone for a backup folder before it backs up, and lists backups once one is picked", async () => {
    const off = { state: "off", device: "d1", name: "This device", addresses: [], peers: [], last_synced_at: "", pending_changes: 0, error: "" } as const;
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
