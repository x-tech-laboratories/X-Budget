// Gives the desktop app's page its calls to the main process, under the names the page looks for.

import { contextBridge, ipcRenderer } from "electron";
import { run_preload } from "@x-tech-laboratories/x-libs/app/preload";

import { app } from "../app.ts";

run_preload(app, { contextBridge, ipcRenderer });
