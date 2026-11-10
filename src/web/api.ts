// The page's one way to the data, whichever host it runs on, and a watch every view reloads on when anything changed,
// here or on another page or device.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { Client } from "@x-tech-laboratories/x-libs/electron/bridge";
import { create_watch } from "@x-tech-laboratories/x-libs/web/watch";
import { use_resource, type Resource } from "@x-tech-laboratories/x-libs/web/react/states";

import type { PageApi } from "../shared/bridge.ts";
import { is_read_only, setting_defaults, type BudgetMethods } from "../shared/store.ts";

// ── Api ──────────────────────────────────────────────────────────────────────

// Bumped after each write this page makes and each change from elsewhere.
export const data_watch = create_watch();

let page_api: PageApi | null = null;

// A write tells this page's views too, since the host only tells the other pages.
export function set_page_api(api: PageApi): void {
  const calls = Object.fromEntries(
    Object.entries(api.calls).map(([name, call]) => [
      name,
      async (...args: unknown[]) => {
        const result: unknown = await (call as (...args: unknown[]) => Promise<unknown>)(...args);
        if (!is_read_only(name)) data_watch.bump();
        return result;
      },
    ]),
  ) as Client<BudgetMethods>;
  page_api = { ...api, calls };
  api.on_change(() => data_watch.bump());
}

export function page(): PageApi {
  if (!page_api) throw new Error("the page's api has not been set up");
  return page_api;
}

// Every data call, such as calls().get_settings().
export function calls(): Client<BudgetMethods> {
  return page().calls;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

// Loads with the page's calls and loads again quietly whenever the data changed.
export function use_data<Data>(load: (api: Client<BudgetMethods>) => Promise<Data>, dependencies: unknown[] = []): Resource<Data> {
  return use_resource(() => load(calls()), dependencies, { watch: data_watch });
}

// Every setting with the defaults filled in.
export function use_settings(): Resource<Record<string, unknown>> {
  return use_data(async (api) => ({ ...setting_defaults, ...(await api.get_settings()) }));
}
