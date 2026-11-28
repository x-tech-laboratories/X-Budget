// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginNeeded } from "@x-tech-laboratories/x-libs/web/states";

import { backup_bridge, budget_bridge, budget_events, certificate_bridge, connection_bridge, desktop_bridge, device_bridge, peer_listening_bridge } from "../src/shared/bridge.ts";
import { desktop_api, is_desktop } from "../src/web/hosts/desktop.ts";
import { web_api } from "../src/web/hosts/web.ts";

// ============================================================================
// Helpers
// ============================================================================

const window_keys: string[] = [];

afterEach(() => {
  for (const key of window_keys.splice(0)) delete (window as unknown as Record<string, unknown>)[key];
  vi.unstubAllGlobals();
});

// Puts what the preload would expose on the window, the connections answering with the daemon in use.
function expose(current: string): { changed: () => void } {
  let listener = (): void => {};
  const exposed: Record<string, unknown> = {
    [budget_bridge.api_name]: { list_budgets: vi.fn() },
    [device_bridge.api_name]: { get_sync_status: vi.fn() },
    [peer_listening_bridge.api_name]: { get_peer_listening: vi.fn() },
    [backup_bridge.api_name]: { list_backups: vi.fn() },
    [certificate_bridge.api_name]: { list_trusted: vi.fn() },
    [desktop_bridge.api_name]: { get_desktop_settings: vi.fn() },
    [connection_bridge.api_name]: { list_connections: vi.fn(async () => ({ connections: [], current })) },
    [budget_events.api_name]: { on: (_event: string, given: () => void) => ((listener = given), () => undefined) },
  };
  Object.assign(window, exposed);
  window_keys.push(...Object.keys(exposed));
  return { changed: () => listener() };
}

// ============================================================================
// Desktop
// ============================================================================

describe("desktop host", () => {
  it("is the desktop only where the preload put its calls", () => {
    expect(is_desktop()).toBe(false);
    expose("local");
    expect(is_desktop()).toBe(true);
  });

  it("offers this computer's sync and listening while its own daemon is in use", async () => {
    expose("local");

    const api = await desktop_api();

    expect(api.host).toBe("desktop");
    expect(api.device).not.toBeNull();
    expect(api.peer_listening).toBeDefined();
    expect(api.connections).toBeDefined();
    expect(api.desktop).toBeDefined();
  });

  it("leaves device sync out on a server's daemon, and passes changes on", async () => {
    const { changed } = expose("home-server");
    const listener = vi.fn();

    const api = await desktop_api();
    api.on_change(listener);
    changed();

    expect(api.device).toBeNull();
    expect(api.peer_listening).toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Web
// ============================================================================

class FakeEventSource {
  static CLOSED = 2;
  static made: FakeEventSource[] = [];
  readyState = 1;
  listeners = new Map<string, (event: { data: string }) => void>();

  url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.made.push(this);
  }

  addEventListener(name: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(name, listener);
  }

  emit(name: string, data = ""): void {
    this.listeners.get(name)?.({ data });
  }
}

describe("web host", () => {
  it("posts calls to the server with the client id it was given, and hears of changes", async () => {
    FakeEventSource.made = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetch = vi.fn(async () => new Response(JSON.stringify([{ id: "main" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const listener = vi.fn();

    const api = web_api();
    api.on_change(listener);
    const events = FakeEventSource.made[0]!;
    events.emit("hello", "client-1");
    const budgets = await api.calls.list_budgets();
    events.emit("changed");
    events.emit("hello", "client-2");

    expect(budgets).toEqual([{ id: "main" }]);
    expect(fetch).toHaveBeenCalledWith("api/call/list_budgets", expect.objectContaining({ headers: expect.objectContaining({ "x-client-id": "client-1" }) }));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reaches the server's sync and backups, and asks to sign in when signed out", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetch = vi.fn(async (path: string) => (path.startsWith("api/device/") ? new Response("", { status: 401 }) : new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetch);

    const api = web_api();

    expect(await api.backups!.create_backup()).toBeUndefined();
    await expect(api.device!.get_sync_status()).rejects.toBeInstanceOf(LoginNeeded);
  });

  it("passes on a server's refusal in its own words", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("That budget does not exist.", { status: 400 })));

    await expect(web_api().calls.list_budgets()).rejects.toThrow("That budget does not exist.");
  });
});
