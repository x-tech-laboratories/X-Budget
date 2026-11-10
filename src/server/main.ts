// Starts the X-Budget web server on the database the config names.

// ── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { AccountStore } from "@x-tech-laboratories/x-libs/server/account_store";
import { read_server_config } from "@x-tech-laboratories/x-libs/server/config";
import { load_accounts } from "@x-tech-laboratories/x-libs/server/passwords";

import { build_app } from "./app.ts";
import { open_budget_database } from "./database.ts";

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
  // Accounts sign people in, so no shared token is needed to listen beyond this machine.
  secret: false,
  options: {
    config: { variable: "X_BUDGET_CONFIG", help: "the JSON config naming the database and the backups folder", placeholder: "<file>", required: true },
    password_hash_file: { variable: "X_BUDGET_PASSWORD_HASH_FILE", help: "the admins' name:hash lines, made with `npm run hash-password -- <name> <file>`", placeholder: "<file>", required: true },
  },
});

const config = JSON.parse(readFileSync(server_config.values.config!, "utf8")) as BudgetConfig;
const database_path = resolve(config.database);
const backups_folder = resolve(config.backups_folder);

// ── Database ─────────────────────────────────────────────────────────────────

const budget = open_budget_database(database_path, backups_folder);

// Accounts are a file of their own beside the budgets, so restoring budgets never changes who can sign in.
const accounts_database = new DatabaseSync(join(dirname(database_path), "accounts.db"));
const accounts = new AccountStore({ database: accounts_database, app_name: "X-Budget", declared: load_accounts("X_BUDGET_PASSWORD_HASH_FILE", server_config.values.password_hash_file) });

// ── Server ───────────────────────────────────────────────────────────────────

const app = await build_app({ database: budget.database, accounts, web_folder: server_config.web_folder, back_up: budget.back_up, backup_methods: budget.backup_methods });
await app.listen({ host: server_config.host, port: server_config.port });
console.info(`X-Budget is serving http://${server_config.host}:${server_config.port}/`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () =>
    void app.close().then(() => {
      budget.close();
      accounts_database.close();
    }),
  );
}
