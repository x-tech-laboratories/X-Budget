# How X-Budget is put together

## The base app

X-Budget runs on the base app in X-App (`app/*`). `src/app.ts` describes it once with `define_app`: its name, ports
and files, the money settings, and the budget feature. Each entry point is one call into the base with that object:
`run_server` in `src/server/main.ts`, `run_daemon` in `src/daemon/main.ts`, `run_desktop` and `run_preload` for the
desktop app, and `render_app` in `src/web/main.tsx` with the pages and the Money section. The server, the daemon, the
window, the hosts, the layout, sign-in and Settings all come from the base; a change X-Budget needs there goes into
X-App, never into a copy here.

## One page, three hosts

The page in `src/web` is the same React tree everywhere. At start, the base's `render_app` picks the host it runs on
and hands the page a `PageApi`:

| Host    | Where the data is                                   | How a call travels                                                         | Sync                                |
| ------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| web     | the server's SQLite file                            | `POST api/call/<method>` with the arguments as JSON                        | the server's own `sync_peer`        |
| desktop | the chosen daemon's: this computer's or a server's  | IPC through the preload to the main process, then to the daemon            | the local daemon's `sync_peer`      |
| android | SQLite in WebAssembly, saved to IndexedDB           | straight to the store in the same page                                     | X-App `sync_peer` in the page      |

## The desktop app

The desktop app is two programs. `src/daemon/main.ts` is a plain Node program that opens `budget.db` in the profile
folder, runs sync and backups, and serves the same `api/call/<method>` routes as the server on a Unix socket, plus
`device`, `peer_listening`, `certificates`, `backups` and `daemon` call tables. It runs on Electron's binary as Node
and keeps running with the window closed.

`src/main/index.ts` is only the window. It starts the local daemon, keeps the list of daemons in X-App `connections`
(This computer, or X-Budget servers signed in to as this device), and passes every call of the page to the chosen one
through X-App `daemon_router`. The device's sync, certificates and own settings always go to this computer's daemon.
Choosing another daemon reloads the window, and the base's desktop host reads which one it is on: on a server's, the
page shows no device sync and treats backups as the server's.

Views never ask which host they are on. They call `calls().<method>(...)` from `src/web/api.ts`, the base's calls typed with X-Budget's own, and load with
`use_data`, which reloads quietly whenever `data_watch` is bumped: after this page writes, and when another page or
device changed something.

## The budget

`src/shared/budget/` holds five files:

- `model.ts`: the rules, as plain functions over lines and transactions. `compute_totals` gives each line's totals
  under the parent rule (computed, own plus children, or cap); `monthly_report` measures a month and `monthly_trend` the
  months before it.
- `store.ts`: the tables and the calls the page makes. Lines keep `parent_id` and `position`, so X-App `web/tree`
  nests them and works out moves. Totals are never stored; only what was typed is, rounded to the decimal places set.
- `trilium.ts`: the Trilium Budget add-on's JSON, read into a new budget and written back.
- `history.ts`: the versions kept of lines and transactions (see History below).
- `api.ts`: what each call does and takes, for other programs (see API and MCP below).

The tables carry no foreign keys: a transaction keeps the id of a line deleted since, which is what makes it
unbudgeted, and sync may bring a row before its parent.

### On and off budget

On budget is every amount that stayed within the limits of the line it was charged to; off budget is every amount
that broke them, plus anything charged to no line. They are kept per column, since money in added to money out means
nothing. Spending splits exactly: on plus off is what was spent. Income cannot, since a shortfall is money that never
arrived; on plus off less the shortfall is what came in.

An amount is measured against the allocation that governs it, and no allocation counts twice:

| Parent rule    | Measured at                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------- |
| Computed       | every leaf, against what it was typed; a parent owns nothing of its own                       |
| Own + children | every line, against what it was typed, with what was charged to it directly                   |
| Cap            | every line with children, against its cap and its whole subtree; its descendants not at all   |

## Pages

`src/web/pages.tsx` lists the sidebar's sections: Plan, Transactions, Report and History, each with its own settings
sections. `src/web/budget/common.tsx` holds what they share: the budget this device views (remembered in the browser,
the first one if it is gone), the month Transactions and Report both show, and amounts formatted in the chosen
currency.

## Sync

The server and every device run the same store, and each is a peer of the others through X-App `sync_peer`. X-App
`sync_engine` stamps every write to a synced table through triggers, value by value; the newest write of each value
wins. Two copies pair once through a code shown by the one the other can reach, then merge with nothing asked. Each
sends its changes within seconds, takes the other's in the same round trip, and keeps working offline. The server
answers peers at `api/sync/peer` with no sign-in, since every call is sealed between the two devices, and serves its own
pairings at `api/device/` to admins. Every device starts with the budget `main`, so two devices set up apart share it
rather than holding one copy each.

## Signing in

In a browser the page reaches the server's data, so the base's page checks the account first and shows X-App'
`SignInForm` until the user is signed in; the server runs `register_accounts` on an `AccountStore` kept in
`accounts.db`, apart from the budgets so a restore never changes who can sign in. Admins come from the
`X_BUDGET_PASSWORD_HASH_FILE` file and manage everyone else on **Your account**. A desktop app that works on a server
signs in once under Settings → Connections for a token of its own; sync itself needs no account.

## Backups

The base keeps what every host's backups share: the names, this device's schedule (a settings row the sync engine keeps
local) and the page's backup calls. The server and the desktop app open their database on X-App's `sqlite_backups`; the phone keeps its backups in a folder it picks through X-App'
`phone_backups`. Each takes a daily backup through `keep_backing_up`, one before a schema upgrade and one before another
copy replaces its data; a restore backs up first, and each paired device is then made to match the restored copy.

## History

Each feature may declare `histories`; the base's store installs them on opening, records a version of every item a
write touched after each call, syncs the versions tables, forgets what sync brings in so each version is recorded once
by the device that made it, and prunes versions older than the `history_days` setting.

## API and MCP

Every call is described once in its feature's `api` (an X-App `ApiSpec`, typed against the calls, so one without a
description does not compile). The server serves the calls three ways from it, behind the same sign-in: `POST
/api/call/<method>` with the arguments as a JSON list or by name as an object, `GET /api/openapi.json`, and `/api/mcp`
for MCP clients, where reading calls are marked read-only. A change made through the API or MCP reaches open pages and
devices like one made in the app.
