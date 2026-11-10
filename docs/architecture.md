# How X-Budget is put together

## One page, three hosts

The page in `src/web` is the same React tree everywhere. At start, `src/web/main.tsx` picks the host it runs on and hands
the page a `PageApi` (`src/shared/bridge.ts`):

| Host    | Where the data is                                   | How a call travels                                   | Sync                        |
| ------- | --------------------------------------------------- | ---------------------------------------------------- | --------------------------- |
| web     | the server's SQLite file                            | `POST api/call/<method>` with the arguments as JSON  | none; the browser is online |
| desktop | `budget.db` in Electron's profile folder            | IPC through the preload (`src/preload/index.ts`)     | X-Libs `sync_client`        |
| android | SQLite in WebAssembly, saved to IndexedDB           | straight to the store in the same page               | X-Libs `sync_client`        |

Views never ask which host they are on. They call `calls().<method>(...)` from `src/web/api.ts` and load with
`use_data`, which reloads quietly whenever `data_watch` is bumped: after this page writes, and when another page or
device changed something.

## The budget

`src/shared/budget/` holds three files:

- `model.ts`: the rules, as plain functions over lines and transactions. `compute_totals` gives each line's totals
  under the parent rule (computed, own plus children, or cap); `monthly_report` measures a month and `monthly_trend` the
  months before it.
- `store.ts`: the tables and the calls the page makes. Lines keep `parent_id` and `position`, so X-Libs `web/tree`
  nests them and works out moves. Totals are never stored; only what was typed is, rounded to the decimal places set.
- `trilium.ts`: the Trilium Budget add-on's JSON, read into a new budget and written back.

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

`src/web/features.tsx` lists the sidebar's sections: Plan, Transactions and Report, each with its own settings
sections. `src/web/budget/common.tsx` holds what they share: the budget this device views (remembered in the browser,
the first one if it is gone), the month Transactions and Report both show, and amounts formatted in the chosen
currency.

## Sync

The server and every device run the same store. X-Libs `sync_engine` stamps every write to a synced table through
triggers, value by value; the newest write of each value wins. A device sends its changes within seconds and takes
everyone else's in the same round trip, follows the server's event stream to hear of changes at once, and keeps working
offline. On first connecting, the user chooses whether the server's copy or the device's wins; the other is backed up.
Every device starts with the budget `main`, so two devices set up apart share it rather than holding one copy each.
