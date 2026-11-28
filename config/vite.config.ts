// The page for a browser, from X-App's preset.

import { defineConfig } from "vite";
import { web_vite_config } from "@x-tech-laboratories/x-app/config/vite";

export default defineConfig(web_vite_config({ port: 7740 }));
