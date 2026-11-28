import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call_daemon, follow_daemon_events, is_answering } from "@x-tech-laboratories/x-libs/local_daemon";

import { start_budget_daemon, type BudgetDaemon, type BudgetDaemonOptions } from "../src/daemon/daemon.ts";
import { read_desktop_settings } from "../src/shared/desktop.ts";

// ============================================================================
// Helpers
// ============================================================================

let folder: string;
let socket_path: string;
const running: BudgetDaemon[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "x-budget-daemon-"));
  socket_path = join(folder, "daemon.sock");
});

afterEach(async () => {
  for (const daemon of running.splice(0)) await daemon.shut_down();
  rmSync(folder, { recursive: true, force: true });
});

// A daemon on a throwaway database and socket, with a free port for other devices so tests never meet.
async function start(options: Partial<BudgetDaemonOptions> = {}): Promise<BudgetDaemon> {
  const daemon = await start_budget_daemon({ database_path: join(folder, "budget.db"), socket_path, on_stopped: () => undefined, default_peer_port: 0, ...options });
  running.push(daemon!);
  return daemon!;
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 100 && !(await check()); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
}

// ============================================================================
// Desktop settings
// ============================================================================

describe("desktop settings", () => {
  it("fills in each default where a setting is missing or damaged", () => {
    expect(read_desktop_settings(null)).toEqual({ keep_running_in_background: true, start_at_login: true });
    expect(read_desktop_settings({ keep_running_in_background: false, start_at_login: "yes" })).toEqual({ keep_running_in_background: false, start_at_login: true });
  });
});

// ============================================================================
// Daemon
// ============================================================================

describe("daemon", { timeout: 30_000 }, () => {
  it("answers the page's calls on its socket, as the server does", async () => {
    await start();

    await call_daemon(socket_path, "/api/call/set_setting", ["currency", "JMD"]);

    expect(await call_daemon(socket_path, "/api/call/list_budgets", [])).toEqual([expect.objectContaining({ id: "main" })]);
    expect(await call_daemon(socket_path, "/api/call/get_settings", [])).toMatchObject({ currency: "JMD" });
  });

  it("answers this computer's own tables: sync, letting devices connect, backups and its settings", async () => {
    await start();

    expect(await call_daemon(socket_path, "/api/device/get_sync_status", [])).toMatchObject({ state: "off", peers: [] });
    expect(await call_daemon(socket_path, "/api/peer_listening/get_peer_listening", [])).toMatchObject({ on: false });
    expect(await call_daemon(socket_path, "/api/backups/list_backups", [])).toEqual(expect.any(Array));
    await call_daemon(socket_path, "/api/daemon/set_desktop_setting", ["start_at_login", false]);
    expect(await call_daemon(socket_path, "/api/daemon/get_desktop_settings", [])).toEqual({ keep_running_in_background: true, start_at_login: false });
  });

  it("tells other windows of a change, but not the one that made it", async () => {
    await start();
    const seen: string[] = [];
    let client_id = "";
    const stop = follow_daemon_events(socket_path, "/api/events", (event, data) => {
      if (event === "hello") client_id = data;
      else seen.push(event);
    });
    await until(() => client_id !== "");

    await call_daemon(socket_path, "/api/call/set_setting", ["currency", "EUR"], { "x-client-id": client_id });
    await call_daemon(socket_path, "/api/call/set_setting", ["currency", "USD"]);
    await until(() => seen.length > 0);
    stop();

    expect(seen).toEqual(["changed"]);
  });

  it("leaves a second daemon on the same database out, since the first already answers", async () => {
    await start();

    expect(await start_budget_daemon({ database_path: join(folder, "budget.db"), socket_path, on_stopped: () => undefined })).toBeNull();
  });

  it("stops when asked, and only once", async () => {
    const on_stopped = vi.fn();
    const daemon = await start({ on_stopped });

    await call_daemon(socket_path, "/api/daemon/stop_daemon", []);
    await until(() => on_stopped.mock.calls.length > 0);
    await daemon.shut_down();

    expect(on_stopped).toHaveBeenCalledTimes(1);
    expect(await is_answering(socket_path)).toBe(false);
  });

  it("stops a while after its last window closed when it is not to keep running", async () => {
    const on_stopped = vi.fn();
    await start({ on_stopped, unused_exit_ms: 100, unused_check_ms: 20 });

    await call_daemon(socket_path, "/api/daemon/set_desktop_setting", ["keep_running_in_background", false]);
    await until(() => on_stopped.mock.calls.length > 0);

    expect(on_stopped).toHaveBeenCalledTimes(1);
  });

  it("runs as a program of its own, as the window starts it", async () => {
    const program = spawn(process.execPath, ["src/daemon/main.ts"], { env: { ...process.env, X_BUDGET_DB: join(folder, "budget.db"), X_BUDGET_SOCKET: socket_path }, stdio: "ignore" });
    await until(() => is_answering(socket_path));

    await call_daemon(socket_path, "/api/daemon/stop_daemon", []);

    expect(await new Promise((resolve) => program.once("exit", resolve))).toBe(0);
  });
});
