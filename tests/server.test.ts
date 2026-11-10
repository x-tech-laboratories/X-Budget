import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { AccountStore } from "@x-tech-laboratories/x-libs/server/account_store";
import { hash_password } from "@x-tech-laboratories/x-libs/server/passwords";

import { build_app } from "../src/server/app.ts";
import { open_store } from "../src/shared/store.ts";

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
  app = await build_app({ database: () => database, accounts, web_folder, back_up: vi.fn(), backup_methods });
  const signed_in = await app.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password } });
  cookie = signed_in.cookies.map((each) => `${each.name}=${each.value}`).join("; ");
  return app;
}

// A call from the signed-in page.
function call(method: string, payload: unknown) {
  return app.inject({ method: "POST", url: `/api/call/${method}`, payload: payload as object, headers: { cookie } });
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
    expect(read.json()).toEqual({ currency: "JMD" });
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

  it("serves sync to a device signed in with a token of its own", async () => {
    await start();
    const signed_in = await app.inject({ method: "POST", url: "/api/login", payload: { name: "admin", password: test_password, device: "Phone" } });
    const device_token = (signed_in.json() as { token: string }).token;
    const snapshot = await app.inject({ method: "GET", url: "/api/sync/snapshot", headers: { authorization: `Bearer ${device_token}` } });
    expect(snapshot.statusCode).toBe(200);
    const { generation, changes } = snapshot.json() as { generation: string; changes: { table: string; key: string }[] };
    expect(generation).not.toBe("");
    expect(changes).toContainEqual(expect.objectContaining({ table: "budgets", key: "main" }));
  });
});
