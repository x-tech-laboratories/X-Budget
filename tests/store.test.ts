import { DatabaseSync } from "node:sqlite";

import { describe, expect, it, vi } from "vitest";

import { bind_methods, is_read_only, open_store, setting_defaults } from "../src/shared/store.ts";

function open_database(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  open_store(database);
  return database;
}

describe("store", () => {
  it("records each feature's schema version and opens again without redoing a step", () => {
    const database = open_database();
    open_store(database);
    const versions = database.prepare("SELECT owner, version FROM schema_versions WHERE owner = 'settings'").all().map((row) => ({ ...row }));
    expect(versions).toEqual([{ owner: "settings", version: 1 }]);
  });

  it("keeps settings as JSON and lays the defaults under them on the page", () => {
    const methods = bind_methods(() => open_database(), () => undefined);
    expect(setting_defaults.currency).toBe("USD");
    expect(setting_defaults["budget.rollup_mode"]).toBe("computed");
    const database = open_database();
    const bound = bind_methods(() => database, () => undefined);
    bound.set_setting("currency", "JMD");
    bound.set_setting("decimals", 0);
    expect(bound.get_settings()).toEqual({ currency: "JMD", decimals: 0 });
    expect(methods.get_settings()).toEqual({});
  });

  it("announces writes and not reads", () => {
    const database = open_database();
    const on_change = vi.fn();
    const bound = bind_methods(() => database, on_change);
    bound.get_settings();
    expect(on_change).not.toHaveBeenCalled();
    bound.set_setting("locale", "en-JM");
    expect(on_change).toHaveBeenCalledOnce();
    expect(is_read_only("list_budgets")).toBe(true);
    expect(is_read_only("add_budget")).toBe(false);
  });
});
