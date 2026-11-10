// Starts the page on whichever host it runs: the desktop app, the phone app or a browser.

// ── Imports ──────────────────────────────────────────────────────────────────

import "@x-tech-laboratories/halon/halon-tokens.css";
import "@x-tech-laboratories/halon/halon.css";
import "./app.css";
import { createRoot } from "react-dom/client";

import { set_page_api } from "./api.ts";
import { App } from "./App.tsx";
import { desktop_api, is_desktop } from "./hosts/desktop.ts";
import { web_api } from "./hosts/web.ts";
import type { PageApi } from "../shared/bridge.ts";

// ── Start ────────────────────────────────────────────────────────────────────

// The phone's code loads only in the phone build, so a browser never fetches SQLite.
async function host_api(): Promise<PageApi> {
  if (is_desktop()) return desktop_api();
  if (import.meta.env.MODE === "android") return (await import("./hosts/android.ts")).android_api();
  return web_api();
}

void host_api().then((api) => {
  set_page_api(api);
  createRoot(document.getElementById("app")!).render(<App />);
});
