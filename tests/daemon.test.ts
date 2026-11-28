import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { call_daemon, is_answering } from "@x-tech-laboratories/x-libs/local_daemon";

let folder: string;
let socket_path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "x-budget-daemon-"));
  socket_path = join(folder, "daemon.sock");
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 400 && !(await check()); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("X-Budget's daemon", { timeout: 30_000 }, () => {
  it("runs as a program of its own, as the window starts it, and answers the budget's calls", async () => {
    const program = spawn(process.execPath, ["src/daemon/main.ts"], { env: { ...process.env, X_BUDGET_DB: join(folder, "budget.db"), X_BUDGET_SOCKET: socket_path }, stdio: "ignore" });
    await until(() => is_answering(socket_path));

    const budgets = await call_daemon(socket_path, "/api/call/list_budgets", []);
    await call_daemon(socket_path, "/api/daemon/stop_daemon", []);

    expect(budgets).toEqual([expect.objectContaining({ id: "main" })]);
    expect(await new Promise((resolve) => program.once("exit", resolve))).toBe(0);
  });
});
