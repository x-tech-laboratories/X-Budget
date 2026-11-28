// Starts the page on whichever host it runs: the desktop app, the phone app or a browser.

import "./app.css";
import { render_app } from "@x-tech-laboratories/x-app/app/web/app_page";

import { app } from "../app.ts";
import { pages } from "./pages.tsx";
import { money_settings } from "./settings/money.tsx";

void render_app({ app, pages, general_settings: money_settings });
