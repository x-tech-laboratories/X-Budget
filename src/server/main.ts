// Starts the X-Budget web server on the database the config names.

import { run_server } from "@x-tech-laboratories/x-libs/app/server";

import { app } from "../app.ts";

await run_server(app, { web_folder: new URL("../../out/web", import.meta.url) });
