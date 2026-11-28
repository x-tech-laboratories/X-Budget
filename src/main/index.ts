// The desktop app's window: Electron's main process, which shows X-Budget and leaves the work to this computer's daemon
// or to the X-Budget server chosen under Settings → Connections.

import * as electron from "electron";
import { run_desktop } from "@x-tech-laboratories/x-libs/app/desktop";

import { app } from "../app.ts";

run_desktop(app, electron, { main_dir: import.meta.dirname });
