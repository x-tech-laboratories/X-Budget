import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

import { build_app } from "../src/server/app.ts";
import { open_store } from "../src/shared/store.ts";

let app: FastifyInstance;

afterEach(async () => {
  await app?.close();
});

async function start(web_folder = "/nonexistent"): Promise<FastifyInstance> {
  const database = new DatabaseSync(":memory:");
  open_store(database);
  app = await build_app({ database, secret: "", web_folder, back_up: vi.fn() });
  return app;
}

describe("server", () => {
  it("serves the built page beside the API", async () => {
    const folder = mkdtempSync(join(tmpdir(), "x-budget-web-"));
    writeFileSync(join(folder, "index.html"), "<title>X-Budget</title>");
    await start(folder);
    expect((await app.inject({ method: "GET", url: "/" })).body).toContain("X-Budget");
    expect((await app.inject({ method: "GET", url: "/api/missing" })).statusCode).toBe(404);
  });

  it("answers the page's calls by name with JSON arguments", async () => {
    await start();
    const write = await app.inject({ method: "POST", url: "/api/call/set_setting", payload: ["currency", "JMD"] });
    expect(write.statusCode).toBe(204);
    const read = await app.inject({ method: "POST", url: "/api/call/get_settings", payload: [] });
    expect(read.json()).toEqual({ currency: "JMD" });
  });

  it("sends a call's answer as JSON even when it is a bare string such as a new id", async () => {
    await start();
    const added = await app.inject({ method: "POST", url: "/api/call/add_budget", payload: ["Trip"] });
    expect(added.headers["content-type"]).toContain("application/json");
    const id: unknown = added.json();
    expect(typeof id).toBe("string");
    const listed = await app.inject({ method: "POST", url: "/api/call/list_budgets", payload: [] });
    expect(listed.json()).toContainEqual(expect.objectContaining({ id, name: "Trip" }));
  });

  it("refuses arguments that are not a list and calls it does not know", async () => {
    await start();
    expect((await app.inject({ method: "POST", url: "/api/call/get_settings", payload: { not: "a list" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/call/drop_everything", payload: [] })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("serves sync to devices", async () => {
    await start();
    const snapshot = await app.inject({ method: "GET", url: "/api/sync/snapshot" });
    expect(snapshot.statusCode).toBe(200);
    const { generation, changes } = snapshot.json() as { generation: string; changes: { table: string; key: string }[] };
    expect(generation).not.toBe("");
    expect(changes).toContainEqual(expect.objectContaining({ table: "budgets", key: "main" }));
  });
});
