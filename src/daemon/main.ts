// Starts the desktop app's daemon on the database and socket the window names, and ends the process once it stops.

import { run_daemon } from "@x-tech-laboratories/x-app/app/daemon";

import { app } from "../app.ts";

await run_daemon(app);
