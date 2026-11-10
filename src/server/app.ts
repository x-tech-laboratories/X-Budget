// The web server: the page, every data call the page makes, and the sync every device runs against, all on one database.

// ── Imports ──────────────────────────────────────────────────────────────────

import fastify, { type FastifyInstance } from "fastify";
import { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { BAD_JSON, register_error_replies, register_lenient_json_body, send_text } from "@x-tech-laboratories/x-libs/server/replies";
import { register_token_sign_in } from "@x-tech-laboratories/x-libs/server/sign_in";
import { register_sync_routes } from "@x-tech-laboratories/x-libs/server/sync_routes";
import { register_web_folder } from "@x-tech-laboratories/x-libs/server/web_folder";
import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";

import { budget_bridge } from "../shared/bridge.ts";
import { bind_methods, is_read_only, sync_engine } from "../shared/store.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface AppOptions {
  database: SqlDatabase;
  // The secret browsers sign in with and devices sync with; empty leaves the server open, which is only allowed on this machine.
  secret: string;
  web_folder: string;
  // Saves a copy of the database before a device's data replaces it.
  back_up: () => void;
}

// ── App ──────────────────────────────────────────────────────────────────────

export async function build_app(options: AppOptions): Promise<FastifyInstance> {
  const app = fastify({ forceCloseConnections: true });
  register_lenient_json_body(app);
  register_error_replies(app);
  await register_token_sign_in(app, { secret: options.secret, title: "X-Budget" });

  const changes = new EventStream();
  const database = () => options.database;

  await app.register(
    async (api) => {
      changes.register(api, "/events");

      // The page's calls arrive as POST /api/call/<method> with the arguments as a JSON list.
      api.post<{ Params: { method: string } }>("/call/:method", async (request, reply) => {
        const args: unknown = request.body ?? [];
        if (args === BAD_JSON || !Array.isArray(args)) return send_text(reply, 400, "send the arguments as a JSON list");
        const methods = bind_methods(database, () => changes.announce_change(changes.client_id_of(request)));
        const result = await budget_bridge.dispatch(methods, request.params.method, args);
        if (result === undefined) return reply.code(204).send();
        // Always JSON, since Fastify sends a bare string such as a new id as plain text the page cannot parse.
        reply.type("application/json");
        if (is_read_only(request.params.method)) reply.header("cache-control", "no-store");
        return reply.send(JSON.stringify(result));
      });

      register_sync_routes(api, {
        engine: sync_engine,
        database,
        back_up: options.back_up,
        on_change: (request) => changes.announce_change(changes.client_id_of(request)),
      });
    },
    { prefix: "/api" },
  );

  await register_web_folder(app, { folder: options.web_folder });
  return app;
}
