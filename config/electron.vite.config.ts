// The desktop app's window, daemon, preload and page, from X-App's preset.

import { defineConfig } from "electron-vite";
import { desktop_vite_config } from "@x-tech-laboratories/x-app/config/electron_vite";

export default defineConfig(desktop_vite_config());
