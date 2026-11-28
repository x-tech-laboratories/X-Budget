// Starts the X-Budget web server on the database the config names.

// ── Imports ──────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { AccountStore } from "@x-tech-laboratories/x-libs/server/account_store";
import { read_server_config } from "@x-tech-laboratories/x-libs/server/config";
import { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { load_accounts } from "@x-tech-laboratories/x-libs/server/passwords";
import { create_sync_peer } from "@x-tech-laboratories/x-libs/sync_peer";
import { file_sync_storage } from "@x-tech-laboratories/x-libs/sync_file_storage";

import { build_app } from "./app.ts";
import { open_budget_database } from "./database.ts";
import { sync_engine } from "../shared/store.ts";

// ── Config ───────────────────────────────────────────────────────────────────

interface BudgetConfig {
  database: string;
  backups_folder: string;
  // Where other devices reach this server's sync, such as "https://budget.example.org/api/"; none unless set.
  sync_address?: string;
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

// ── Sync ─────────────────────────────────────────────────────────────────────

// Every page hears of a change, whether a page or another device made it.
const changes = new EventStream();

// The server is one sync peer among the devices, kept beside the budgets so a restore leaves its pairings be.
const sync = create_sync_peer({
  app: "x-budget",
  engine: sync_engine,
  database: budget.database,
  storage: file_sync_storage({ file: join(dirname(database_path), "sync-peers.json"), back_up_before_replace: budget.back_up }),
  device_name: `X-Budget server on ${hostname()}`,
  addresses: () => (config.sync_address ? [config.sync_address] : []),
  on_remote_change: () => changes.announce_change(),
});

// ── Server ───────────────────────────────────────────────────────────────────

const app = await build_app({ database: budget.database, accounts, web_folder: server_config.web_folder, sync, changes, backup_methods: budget.backup_methods });
await app.listen({ host: server_config.host, port: server_config.port });
sync.start();
console.info(`X-Budget is serving http://${server_config.host}:${server_config.port}/`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () =>
    void app.close().then(() => {
      sync.stop();
      budget.close();
      accounts_database.close();
    }),
  );
}
