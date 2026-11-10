// Starts the X-Budget web server on the database the config names.

// ── Imports ──────────────────────────────────────────────────────────────────

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { read_server_config } from "@x-tech-laboratories/x-libs/server/config";

import { open_store } from "../shared/store.ts";
import { build_app } from "./app.ts";

// ── Config ───────────────────────────────────────────────────────────────────

interface BudgetConfig {
  database: string;
  backups_folder: string;
}

const server_config = read_server_config({
  program: "x-budget",
  summary: "Serves X-Budget as a web app and syncs its devices.",
  env_prefix: "X_BUDGET",
  default_port: 7740,
  web_folder_default: join(import.meta.dirname, "../../out/web"),
  options: { config: { variable: "X_BUDGET_CONFIG", help: "the JSON config naming the database and the backups folder", placeholder: "<file>", required: true } },
});

const config = JSON.parse(readFileSync(server_config.values.config!, "utf8")) as BudgetConfig;
const database_path = resolve(config.database);
const backups_folder = resolve(config.backups_folder);

// ── Database ─────────────────────────────────────────────────────────────────

mkdirSync(dirname(database_path), { recursive: true });
const database = new DatabaseSync(database_path);
database.exec("PRAGMA journal_mode = WAL");
open_store(database);

// A copy of the whole database, named for when it was taken.
function back_up(): void {
  mkdirSync(backups_folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  database.prepare("VACUUM INTO ?").run(join(backups_folder, `budget-${stamp}.db`));
}

// ── Server ───────────────────────────────────────────────────────────────────

const app = await build_app({ database, secret: server_config.secret, web_folder: server_config.web_folder, back_up });
await app.listen({ host: server_config.host, port: server_config.port });
console.info(`X-Budget is serving http://${server_config.host}:${server_config.port}/`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void app.close().then(() => database.close()));
}
