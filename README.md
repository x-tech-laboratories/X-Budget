# X-Budget

<a href="https://liberapay.com/BeatLink/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a> <a href="https://ko-fi.com/I4V52ANK6N"><img alt="Support me on Ko-fi" src="https://ko-fi.com/img/githubbutton_sm.svg"></a>

A budget you plan once and measure every month. It runs as a web page served by your own server, as a desktop app and
as an Android app; the desktop and Android apps keep their own copy of the data, work offline, and sync with the server
whenever it can be reached.

- **Plan:** income and expense lines nested as deep as you like, edited in place. A parent line is the sum of the lines
  under it, its own amount plus theirs, or a cap they draw on, as chosen under Settings.
- **Transactions:** what actually came in and went out, one month at a time, each charged to a line or left
  unbudgeted. A transaction can carry both an income and an expense, such as a refund less a fee.
- **Report:** the month measured against the plan. On budget is every amount that stayed within the limits of its
  line; off budget is every amount that broke them, plus anything unbudgeted. It also lists what went off budget, each
  line's plan beside what moved, the month's income, and a trend over the months before.

- **History:** every change to a line or transaction, on every device, any version restorable and a deleted line
  brought back with the lines deleted along with it.

Keep as many budgets as you like, each with its own plan and transactions. X-Budget is a port of the Trilium Budget
add-on and reads and writes its JSON, so a budget moves between the two.

## Running it

```sh
nix-shell                 # Node 24 and an Electron that runs on NixOS
npm install
npm run hash-password -- admin dev-data/password.hash   # the first admin, asked for a password
npm run dev:server        # the server on http://127.0.0.1:7740, with the data in dev-data/
npm run dev:web           # the page with live reload, reaching that server
npm run dev               # the desktop app, with its profile in dev-data/desktop
```

`npm run build` type-checks and builds the page into `out/web`; `npm start` serves it. `npm run build:desktop` builds
the desktop app into `out/`, and `npm run build:android` builds the phone's page and copies it into `android/`
(build the app itself in `nix develop .#android` with `cd android && ./gradlew assembleDebug`).

## Configuration

The server reads a JSON file named by `X_BUDGET_CONFIG`; `config.example.json` is the complete default:

| Field            | Means                                                     |
| ---------------- | --------------------------------------------------------- |
| `database`       | the budgets' SQLite file, made if missing; the accounts go in `accounts.db` beside it |
| `backups_folder` | where the server's backups go                                                          |

The address and port come from `X_BUDGET_HOST` and `X_BUDGET_PORT` (or `--host` and `--port`), 127.0.0.1:7740 unless
set. `x-budget --help` lists every option.

## Signing in

The browser signs in with a name and password. The admins are the `name:hash` lines in the file
`X_BUDGET_PASSWORD_HASH_FILE` names, each added with `npm run hash-password -- <name> <file>`, which asks for the
password rather than taking it on the command line. An admin adds everyone else on the **Your account** page, where each
user also changes their password, turns on a second factor, and ends sessions and device tokens.

The currency, locale, decimal places, how parent lines add up and how many months the trend shows are set in the app
under **Settings**, and sync to every device.

## Sync

In the desktop or Android app, open **Settings → This device → Sync**, enter the server's address, your name and
password, and choose whether this device starts from the server's budgets or the server from this device's. The device
keeps a token of its own, which **Your account** can revoke. The copy that loses is backed up
first. After that, changes go both ways within seconds, and a device that is offline catches up once it is back.

## Backups

The server, each desktop app and each phone back up their budgets every day, keeping the last 14, and before anything
replaces them: a restore, a sync that takes the other copy, and a schema upgrade. **Settings** lists the backups, makes one by
hand, restores one (backing up the current budgets first), and sets the schedule, which belongs to that device and does
not sync. In a browser this is the server's, under **Settings → Server**, for admins. Accounts are kept apart from the
budgets, so a restore never changes who can sign in.

The Android app keeps its backups in a folder picked once under **Settings → This device → Backups**, in the phone's
own storage where file managers and sync apps reach them; until a folder is picked it takes none.

## History

Every change to a line or a transaction is kept as a version: open **History…** from a line's menu or the ⟲ on a
transaction to see its versions, or the **History** page for the latest changes to the whole budget. Restoring a version
makes it the current one again, and bringing back a deleted line brings back the lines deleted along with it. Versions
sync with the budgets, and each device records only its own changes. Versions older than **Settings → History → Days
kept** (a year unless set) go, each line and transaction keeping its newest.

## API and MCP

Every call the page makes is open to scripts and AI clients behind the same sign-in, sending a token made on **Your
account** as a bearer header: `POST /api/call/<method>` with the arguments as a JSON list or by name as an object,
`GET /api/openapi.json` describing every call, and `/api/mcp` for MCP clients over streamable HTTP. Amounts are in the
currency set under Settings, days such as `2026-11-10` and months such as `2026-11`.

## Moving from Trilium

Export a budget note from the Trilium Budget add-on with **Export JSON**, then in X-Budget open **Settings → Plan →
Budgets → Import JSON…**. The file becomes a new budget named after it; nothing already here is replaced. Files from
before the add-on's 2.0, with one `amount` per row, read that amount as the expense.

## NixOS

```nix
inputs.x-budget.url = "github:x-tech-laboratories/X-Budget";

imports = [ x-budget.nixosModules.default ];
services.x-budget = {
  enable = true;
  adminsFile = "/var/lib/secrets/x-budget-admins";
};
```

`packages.default` is the server, with `x-budget-hash-password` for the admins file, and `packages.desktop` the
desktop app.

## Layout

```
src/
  server/    Fastify app and main.ts
  main/      Electron main process: its database, the page's calls, sync
  preload/   the desktop page's bridge
  web/       the React page: budget/ for Plan, Transactions, Report and their settings, and hosts/ for web, desktop and Android
  shared/    the store every host runs, budget/ with its rules and the Trilium file format, and the bridge's method tables
tests/       one *.test.ts per behaviour
docs/        architecture.md
android/     the Capacitor project
nix/         package.nix, desktop-package.nix, module.nix
```

## License

GPL-3.0-or-later.
