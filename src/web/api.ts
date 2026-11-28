// The page's calls typed with X-Budget's own, on whichever host the base app started the page.

import { page_hooks } from "@x-tech-laboratories/x-libs/app/web/page";

import type { BudgetMethods } from "../app.ts";

export const { calls, page, use_data, use_settings } = page_hooks<BudgetMethods>();
