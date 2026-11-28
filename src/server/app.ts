// The web server: the page, every data call the page makes, and the server's own sync peer, all on one database.

// ── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";

import fastify, { type FastifyInstance } from "fastify";
import { openapi_document } from "@x-tech-laboratories/x-libs/api_spec";
import { register_mcp_route } from "@x-tech-laboratories/x-libs/server/mcp";
import type { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { BAD_JSON, register_error_replies, register_lenient_json_body, send_text } from "@x-tech-laboratories/x-libs/server/replies";
import { register_accounts } from "@x-tech-laboratories/x-libs/server/account_sign_in";
import type { AccountStore } from "@x-tech-laboratories/x-libs/server/account_store";
import { register_sync_peer_routes } from "@x-tech-laboratories/x-libs/server/sync_peer_routes";
import { register_web_folder } from "@x-tech-laboratories/x-libs/server/web_folder";
import type { BackupMethods } from "@x-tech-laboratories/x-libs/backups";
import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";

import { backup_bridge, budget_bridge } from "../shared/bridge.ts";
import { register_call_table } from "@x-tech-laboratories/x-libs/server/call_table";
import { sync_device_methods, type SyncPeer } from "@x-tech-laboratories/x-libs/sync_peer";

import { bind_methods, budget_api_spec, is_read_only } from "../shared/store.ts";
import { register_budget_calls } from "./calls.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface AppOptions {
  // The open connection, which a restore replaces.
  database: () => SqlDatabase;
  // Who may sign in: browsers with a session, and desktop apps working on this server with a token of their own.
  accounts: AccountStore;
  web_folder: string;
  // The server's copy as a sync peer, which other devices pair with and send their sealed changes to.
  sync: SyncPeer;
  // Every page's event stream, also told when another device's changes arrived.
  changes: EventStream;
  // The server's own backups, which only an admin reaches.
  backup_methods: BackupMethods;
}

// ── Other programs ───────────────────────────────────────────────────────────

const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

const instructions = [
  "X-Budget holds budgets: each a tree of planned income and expense lines, and a ledger of the transactions that actually moved, measured month by month against the plan.",
  "Days are local dates such as 2026-11-10 and months such as 2026-11; amounts are in the currency get_settings gives, rounded to its decimal places.",
  'Start with list_budgets (every device has the budget "main"), then get_budget_plan, list_budget_transactions and get_budget_report.',
].join(" ");

// ── App ──────────────────────────────────────────────────────────────────────

// The server's backups and its sync peer's pairings, which only an admin reaches.
const admin_paths = ["/api/backups/", "/api/device/"];

export async function build_app(options: AppOptions): Promise<FastifyInstance> {
  const app = fastify({ forceCloseConnections: true });
  register_lenient_json_body(app);
  register_error_replies(app);
  await register_accounts(app, {
    accounts: options.accounts,
    cookie_name: "x_budget_session",
    // Each peer call is sealed between the two devices, so it needs no sign-in.
    open_paths: ["/api/sync/peer"],
    // A read-only token may still list and read through MCP, which posts every request.
    read_only_paths: ["/api/mcp"],
    needed: (_method, path) => (admin_paths.some((admin_path) => path.startsWith(admin_path)) ? { role: options.accounts.top_role } : "any"),
  });

  const { changes } = options;
  const database = options.database;

  await app.register(
    async (api) => {
      changes.register(api, "/events");

      register_budget_calls(api, database, changes);

      api.get("/openapi.json", async () =>
        openapi_document(budget_api_spec, { title: "X-Budget", version, description: instructions, path_of: (method) => `/api/call/${method}`, is_read_only }),
      );

      // A change made through MCP is announced to every page, since no page made it.
      await register_mcp_route(api, {
        name: "x-budget",
        version,
        instructions,
        api: budget_api_spec,
        is_read_only,
        call: (method, args) => budget_bridge.dispatch(bind_methods(database, () => changes.announce_change()), method, args),
      });

      // The server's backups, as the page's Settings reach them.
      api.post<{ Params: { method: string } }>("/backups/:method", async (request, reply) => {
        const args: unknown = request.body ?? [];
        if (args === BAD_JSON || !Array.isArray(args)) return send_text(reply, 400, "send the arguments as a JSON list");
        const result = await backup_bridge.dispatch(options.backup_methods, request.params.method, args);
        if (result === undefined) return reply.code(204).send();
        return reply.type("application/json").header("cache-control", "no-store").send(JSON.stringify(result));
      });

      register_sync_peer_routes(api, options.sync);
      register_call_table(api, "/device", sync_device_methods(options.sync), { is_read_only });
    },
    { prefix: "/api" },
  );

  await register_web_folder(app, { folder: options.web_folder });
  return app;
}
