// The page's data calls as routes, the same on the web server and on the desktop app's daemon: POST /call/<method>
// with the arguments as a JSON list, or by name as a JSON object.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import { positional_args } from "@x-tech-laboratories/x-libs/api_spec";
import type { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { send_text } from "@x-tech-laboratories/x-libs/server/replies";
import type { SqlDatabase } from "@x-tech-laboratories/x-libs/sql";

import { budget_bridge } from "../shared/bridge.ts";
import { bind_methods, budget_api_spec, is_read_only, type BudgetMethods } from "../shared/store.ts";

// ── Arguments ────────────────────────────────────────────────────────────────

// Turns a body into the call's arguments: a JSON list in order, or a JSON object by name.
export function call_args(method: string, body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const spec = budget_api_spec[method as keyof BudgetMethods];
  if (spec && typeof body === "object" && body !== null) return positional_args(spec, body as Record<string, unknown>);
  throw new Error("send the arguments as a JSON list or object");
}

// ── Routes ───────────────────────────────────────────────────────────────────

// An import arrives as one call's argument.
const import_body_limit = 32 * 1024 * 1024;

// A change reaches every page and window but the one that made it, which already shows it.
export function register_budget_calls(api: FastifyInstance, database: () => SqlDatabase, changes: EventStream): void {
  api.post<{ Params: { method: string } }>("/call/:method", { bodyLimit: import_body_limit }, async (request, reply) => {
    let args: unknown[];
    try {
      args = call_args(request.params.method, request.body ?? []);
    } catch (error) {
      return send_text(reply, 400, (error as Error).message);
    }
    const methods = bind_methods(database, () => changes.announce_change(changes.client_id_of(request)));
    const result = await budget_bridge.dispatch(methods, request.params.method, args);
    if (result === undefined) return reply.code(204).send();
    // Always JSON, since Fastify sends a bare string such as a new id as plain text the page cannot parse.
    reply.type("application/json");
    if (is_read_only(request.params.method)) reply.header("cache-control", "no-store");
    return reply.send(JSON.stringify(result));
  });
}
