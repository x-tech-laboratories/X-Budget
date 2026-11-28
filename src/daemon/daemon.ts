// The desktop app's daemon: everything X-Budget does without a window, being the database, sync and backups. The window
// reaches it over a Unix socket with the same calls a browser makes to the web server, and closing the window leaves it
// running.

// ── Imports ──────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import fastify, { type FastifyInstance } from "fastify";
import { create_certificate_trust } from "@x-tech-laboratories/x-libs/certificates";
import { DaemonRunningError, listen_on_socket } from "@x-tech-laboratories/x-libs/local_daemon";
import { register_call_table } from "@x-tech-laboratories/x-libs/server/call_table";
import { EventStream } from "@x-tech-laboratories/x-libs/server/events";
import { register_error_replies, register_lenient_json_body } from "@x-tech-laboratories/x-libs/server/replies";
import { create_sync_peer, sync_device_methods } from "@x-tech-laboratories/x-libs/sync_peer";
import { keep_listening_for_peers } from "@x-tech-laboratories/x-libs/sync_peer_listening";
import { file_sync_storage } from "@x-tech-laboratories/x-libs/sync_file_storage";

import { read_desktop_settings, type DaemonMethods, type DesktopSettings } from "../shared/desktop.ts";
import { is_read_only, sync_engine } from "../shared/store.ts";
import { register_budget_calls } from "../server/calls.ts";
import { open_budget_database } from "../server/database.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface BudgetDaemonOptions {
  database_path: string;
  socket_path: string;
  // Runs once the daemon has stopped, such as to end the process.
  on_stopped: () => void;
  // How long it waits after its last window closed before it stops, when it is not to keep running in the background.
  unused_exit_ms?: number;
  unused_check_ms?: number;
  // The port other devices reach this computer's sync on once it lets them connect.
  default_peer_port?: number;
}

export interface BudgetDaemon {
  // Stops sync, the socket and the database, then runs on_stopped; a second call does nothing.
  shut_down: () => Promise<void>;
}

// ── Daemon ───────────────────────────────────────────────────────────────────

// Answers on the socket and starts sync; null when another daemon on the same database already answers.
export async function start_budget_daemon(options: BudgetDaemonOptions): Promise<BudgetDaemon | null> {
  const { database_path, socket_path } = options;
  const profile = dirname(database_path);
  const unused_exit_ms = options.unused_exit_ms ?? 30_000;
  const unused_check_ms = options.unused_check_ms ?? 5000;

  // Backed up before an upgrade, before another copy replaces it, and daily, beside the database.
  const budget = open_budget_database(database_path, join(profile, "backups"));

  // Every window's event stream, told when the data changed or sync's status moved.
  const changes = new EventStream();

  // Server certificates the user trusted, such as a home server's self-signed one, handed to Node's own fetch.
  const certificates = create_certificate_trust({ file: join(profile, "trusted-certificates.json"), use_in_node: true });

  // Off until "Let other devices connect" is turned on; then other devices reach this computer's sync on its port.
  const listening = keep_listening_for_peers({ peer: () => sync, app: "x-budget", file: join(profile, "sync-listening.json"), default_port: options.default_peer_port ?? 7741 });

  // This computer is one sync peer among the devices, reaching out to the ones it is paired with.
  const sync = create_sync_peer({
    app: "x-budget",
    engine: sync_engine,
    database: budget.database,
    storage: file_sync_storage({ file: join(profile, "sync-peers.json"), back_up_before_replace: budget.back_up }),
    device_name: `X-Budget on ${hostname()}`,
    addresses: () => listening.addresses(),
    on_remote_change: () => changes.announce_change(),
    on_status: (status) => changes.send(JSON.stringify(status), { event: "sync_status" }),
  });

  // ── Desktop settings ───────────────────────────────────────────────────

  const desktop_file = join(profile, "desktop.json");

  function read_desktop(): DesktopSettings {
    return read_desktop_settings(existsSync(desktop_file) ? JSON.parse(readFileSync(desktop_file, "utf8")) : null);
  }

  const daemon_methods: DaemonMethods = {
    get_desktop_settings: read_desktop,
    set_desktop_setting: (key, value) => writeFileSync(desktop_file, JSON.stringify(read_desktop_settings({ ...read_desktop(), [key]: value }), null, 2)),
    // Stops once the answer has gone back.
    stop_daemon: () => void setTimeout(() => void shut_down(), 0),
  };

  // ── Calls ──────────────────────────────────────────────────────────────

  const daemon: FastifyInstance = fastify({ bodyLimit: 32 * 1024 * 1024, forceCloseConnections: true });
  register_lenient_json_body(daemon);
  register_error_replies(daemon);
  // A change from one window reaches the others; the one that made it already shows it.
  const tell_others = (client_id: string): void => changes.announce_change(client_id);
  await daemon.register(
    async (api) => {
      changes.register(api, "/events");
      register_budget_calls(api, budget.database, changes);
      register_call_table(api, "/backups", budget.backup_methods, { is_read_only, on_change: tell_others });
      register_call_table(api, "/device", sync_device_methods(sync), { is_read_only, on_change: tell_others });
      register_call_table(api, "/peer_listening", listening.methods, { is_read_only });
      register_call_table(api, "/certificates", certificates.methods, { is_read_only });
      register_call_table(api, "/daemon", daemon_methods, { is_read_only, on_change: tell_others });
    },
    { prefix: "/api" },
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────

  let stopping: Promise<void> | null = null;
  let unused_timer: ReturnType<typeof setInterval> | undefined;

  function shut_down(): Promise<void> {
    stopping ??= (async () => {
      clearInterval(unused_timer);
      sync.stop();
      await daemon.close();
      await listening.stop();
      budget.close();
      options.on_stopped();
    })();
    return stopping;
  }

  try {
    await listen_on_socket(socket_path, (path) => daemon.listen({ path }));
  } catch (error) {
    await daemon.close();
    budget.close();
    // Another daemon on this database got there first, which is all that was asked for.
    if (error instanceof DaemonRunningError) return null;
    throw error;
  }

  await listening.start();
  sync.start();

  // Without "Keep running in the background", the daemon stops a while after its last window has gone.
  let unused_since = Date.now();
  unused_timer = setInterval(() => {
    if (changes.client_count > 0 || read_desktop().keep_running_in_background) unused_since = Date.now();
    else if (Date.now() - unused_since >= unused_exit_ms) void shut_down();
  }, unused_check_ms);

  return { shut_down };
}
