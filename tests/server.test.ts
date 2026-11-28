import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { build_server } from "@x-tech-laboratories/x-libs/app/server";
import { AccountStore } from "@x-tech-laboratories/x-libs/server/account_store";
import { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { hash_password } from "@x-tech-laboratories/x-libs/server/passwords";
import { create_sync_peer } from "@x-tech-laboratories/x-libs/sync_peer";
import { file_sync_storage } from "@x-tech-laboratories/x-libs/sync_file_storage";

import { app } from "../src/app.ts";

// ============================================================================
// Helpers
// ============================================================================

let server: FastifyInstance;
let cookie = "";

// A made-up password for the throwaway admin these tests sign in as.
const test_password = "budget test password";

afterEach(async () => {
  await server?.close();
});

async function start(): Promise<void> {
  const database = new DatabaseSync(":memory:");
  app.open_store(database);
  const accounts = new AccountStore({ database: new DatabaseSync(":memory:"), app_name: "X-Budget", declared: new Map([["admin", hash_password(test_password)]]) });
  const sync = create_sync_peer({
    app: "x-budget",
    engine: app.sync_engine,
    database: () => database,
    storage: file_sync_storage({ file: join(mkdtempSync(join(tmpdir(), "x-budget-peers-")), "sync-peers.json"), back_up_before_replace: vi.fn() }),
    device_name: "X-Budget test server",
  });
  const backups = { list_backups: vi.fn(async () => []), create_backup: vi.fn(), restore_backup: vi.fn(), remove_backup: vi.fn(), get_backup_schedule: vi.fn(), set_backup_schedule: vi.fn() };
  server = await build_server(app, { database: () => database, accounts, web_folder: "/nonexistent", sync, changes: new EventStream(), backup_methods: backups });
  const signed_in = await server.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password } });
  cookie = signed_in.cookies.map((each) => `${each.name}=${each.value}`).join("; ");
}

function call(method: string, payload: unknown) {
  return server.inject({ method: "POST", url: `/api/call/${method}`, payload: payload as object, headers: { cookie } });
}

// Sends one MCP request as a signed-in client speaking the 2025 protocol would, and gives back its result.
async function mcp(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const reply = await server.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { cookie, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = /^data: (.+)$/m.exec(reply.body)?.[1] ?? reply.body;
  return (JSON.parse(data) as { result: Record<string, unknown> }).result;
}

// ============================================================================
// Server
// ============================================================================

describe("X-Budget's server", () => {
  it("adds a budget and lists it, its new id answered as JSON", async () => {
    await start();

    const added = await call("add_budget", ["Trip"]);

    expect(added.headers["content-type"]).toContain("application/json");
    expect((await call("list_budgets", [])).json()).toContainEqual(expect.objectContaining({ id: added.json(), name: "Trip" }));
  });

  it("describes the budget's calls in its OpenAPI document", async () => {
    await start();

    const document = (await server.inject({ method: "GET", url: "/api/openapi.json", headers: { cookie } })).json() as { info: { title: string }; paths: Record<string, unknown> };

    expect(document.info.title).toBe("X-Budget");
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(["/api/call/get_budget_report", "/api/call/restore_line_version"]));
  });

  it("renames a budget through MCP, reads marked read-only", async () => {
    await start();
    await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tests", version: "1" } });
    const { tools } = (await mcp("tools/list")) as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };

    await mcp("tools/call", { name: "rename_budget", arguments: { id: "main", name: "Household" } });

    expect(tools.find((tool) => tool.name === "list_budgets")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "add_budget_line")?.annotations?.readOnlyHint).toBe(false);
    expect((await call("list_budgets", [])).json()).toEqual([expect.objectContaining({ id: "main", name: "Household" })]);
  });
});
