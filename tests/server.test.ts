import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { AccountStore } from "@x-tech-laboratories/x-libs/server/account_store";
import { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { hash_password } from "@x-tech-laboratories/x-libs/server/passwords";
import { create_sync_peer } from "@x-tech-laboratories/x-libs/sync_peer";
import { file_sync_storage } from "@x-tech-laboratories/x-libs/sync_file_storage";

import { build_app } from "../src/server/app.ts";
import { open_store, sync_engine } from "../src/shared/store.ts";

let app: FastifyInstance;
let cookie = "";
let accounts: AccountStore;

const backup_methods = {
  list_backups: vi.fn(async () => []),
  create_backup: vi.fn(),
  restore_backup: vi.fn(),
  remove_backup: vi.fn(),
  get_backup_schedule: vi.fn(() => ({ automatic: true, to_keep: 14 })),
  set_backup_schedule: vi.fn(),
};

// A made-up password for the throwaway admin these tests sign in as.
const test_password = "budget test password";

afterEach(async () => {
  await app?.close();
});

async function start(web_folder = "/nonexistent"): Promise<FastifyInstance> {
  const database = new DatabaseSync(":memory:");
  open_store(database);
  accounts = new AccountStore({ database: new DatabaseSync(":memory:"), app_name: "X-Budget", declared: new Map([["admin", hash_password(test_password)]]) });
  const sync = create_sync_peer({
    app: "x-budget",
    engine: sync_engine,
    database: () => database,
    storage: file_sync_storage({ file: join(mkdtempSync(join(tmpdir(), "x-budget-peers-")), "sync-peers.json"), back_up_before_replace: vi.fn() }),
    device_name: "X-Budget test server",
    addresses: () => ["https://budget.example.org/api/"],
  });
  app = await build_app({ database: () => database, accounts, web_folder, sync, changes: new EventStream(), backup_methods });
  const signed_in = await app.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password } });
  cookie = signed_in.cookies.map((each) => `${each.name}=${each.value}`).join("; ");
  return app;
}

// A call from the signed-in page.
function call(method: string, payload: unknown) {
  return app.inject({ method: "POST", url: `/api/call/${method}`, payload: payload as object, headers: { cookie } });
}

// Sends one MCP request as a signed-in client speaking the 2025 protocol would, and gives back its result.
async function mcp(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
  const reply = await app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { cookie, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    payload: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = /^data: (.+)$/m.exec(reply.body)?.[1] ?? reply.body;
  return (JSON.parse(data) as { result: Record<string, unknown> }).result;
}

describe("server", () => {
  it("serves the built page beside the API", async () => {
    const folder = mkdtempSync(join(tmpdir(), "x-budget-web-"));
    writeFileSync(join(folder, "index.html"), "<title>X-Budget</title>");
    await start(folder);
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain("X-Budget");
    expect((await app.inject({ method: "GET", url: "/api/missing", headers: { cookie } })).statusCode).toBe(404);
  });

  it("answers the page's calls by name with JSON arguments", async () => {
    await start();
    const write = await call("set_setting", ["currency", "JMD"]);
    expect(write.statusCode).toBe(204);
    const read = await call("get_settings", []);
    expect(read.json()).toMatchObject({ currency: "JMD", decimals: 2 });
  });

  it("sends a call's answer as JSON even when it is a bare string such as a new id", async () => {
    await start();
    const added = await call("add_budget", ["Trip"]);
    expect(added.headers["content-type"]).toContain("application/json");
    const id: unknown = added.json();
    expect(typeof id).toBe("string");
    const listed = await call("list_budgets", []);
    expect(listed.json()).toContainEqual(expect.objectContaining({ id, name: "Trip" }));
  });

  it("refuses arguments that are not a list and calls it does not know", async () => {
    await start();
    expect((await call("get_settings", { not: "a list" })).statusCode).toBe(400);
    expect((await call("drop_everything", [])).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("lets only an admin reach the server's backups", async () => {
    await start();
    const listed = await app.inject({ method: "POST", url: "/api/backups/list_backups", payload: [], headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);

    accounts.create_user({ name: "reader", role: "user", access: null, password: "another made-up password" });
    const reader = await app.inject({ method: "POST", url: "/api/login", payload: { name: "reader", password: "another made-up password" } });
    const reader_cookie = reader.cookies.map((each) => `${each.name}=${each.value}`).join("; ");
    expect((await app.inject({ method: "POST", url: "/api/backups/list_backups", payload: [], headers: { cookie: reader_cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/call/list_budgets", payload: [], headers: { cookie: reader_cookie } })).statusCode).toBe(200);
  });

  it("turns away calls from a page that has not signed in", async () => {
    await start();
    const refused = await app.inject({ method: "POST", url: "/api/call/list_budgets", payload: [] });
    expect(refused.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: "wrong" } })).statusCode).toBe(401);
  });

  it("turns away a percent-encoded API path from a page that has not signed in", async () => {
    await start();
    const refused = await app.inject({ method: "POST", url: "/%61pi/call/list_budgets", payload: [] });
    expect([400, 401]).toContain(refused.statusCode);
  });

  it("answers a desktop app working on the server with a token of its own", async () => {
    await start();
    const signed_in = await app.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password, device: "X-Budget on laptop" } });
    const device_token = (signed_in.json() as { token: string }).token;

    const listed = await app.inject({ method: "POST", url: "/api/call/list_budgets", payload: [], headers: { authorization: `Bearer ${device_token}` } });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([expect.objectContaining({ id: "main" })]);
  });

  it("takes a call's arguments by name as a JSON object too", async () => {
    await start();
    expect((await call("set_setting", { value: "JMD", key: "currency" })).statusCode).toBe(204);
    expect((await call("get_settings", [])).json()).toMatchObject({ currency: "JMD", decimals: 2 });
    expect((await call("rename_budget", { id: "main" })).statusCode).toBe(400);
    const not_a_list = await app.inject({ method: "POST", url: "/api/call/list_budgets", payload: "5", headers: { cookie, "content-type": "application/json" } });
    expect(not_a_list.statusCode).toBe(400);
    expect((await call("no_such_call", [])).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("describes every call in an OpenAPI document", async () => {
    await start();
    const document = (await app.inject({ method: "GET", url: "/api/openapi.json", headers: { cookie } })).json() as { info: { title: string }; paths: Record<string, unknown> };
    expect(document.info.title).toBe("X-Budget");
    expect(Object.keys(document.paths)).toContain("/api/call/get_budget_report");
    expect(Object.keys(document.paths)).toContain("/api/call/restore_line_version");
  });

  it("serves every call as an MCP tool, reads marked read-only, and runs one on the budgets", async () => {
    await start();
    await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tests", version: "1" } });
    const { tools } = (await mcp("tools/list")) as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] };
    expect(tools.find((tool) => tool.name === "list_budgets")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "add_budget_line")?.annotations?.readOnlyHint).toBe(false);

    await mcp("tools/call", { name: "rename_budget", arguments: { id: "main", name: "Household" } });
    expect((await call("list_budgets", [])).json()).toEqual([expect.objectContaining({ id: "main", name: "Household" })]);
  });
});

describe("sync between devices", () => {
  it("answers other devices' sealed calls without a sign-in", async () => {
    await start();

    const reply = await app.inject({ method: "POST", url: "/api/sync/peer", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("not sealed") });

    expect(reply.statusCode).not.toBe(401);
  });

  it("shows the server's own pairing only to a signed-in admin", async () => {
    await start();

    const signed_out = await app.inject({ method: "POST", url: "/api/device/get_sync_status", payload: [] });
    const admin = await app.inject({ method: "POST", url: "/api/device/create_pairing_code", payload: [], headers: { cookie } });

    expect(signed_out.statusCode).toBe(401);
    expect(admin.statusCode).toBe(200);
    expect(JSON.parse(admin.body)).toHaveProperty("code");
  });
});
