// The argument shapes many calls share, as JSON Schema, for the specs other programs read through MCP and OpenAPI.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { JsonSchema } from "@x-tech-laboratories/x-libs/api_spec";

// ── Shapes ───────────────────────────────────────────────────────────────────

export function text(description: string): JsonSchema {
  return { type: "string", description };
}

export function id_of(thing: string): JsonSchema {
  return { type: "string", description: `The ${thing}'s id, as a list or get call gives it.` };
}

export const budget_id: JsonSchema = { type: "string", description: 'The budget\'s id, as list_budgets gives it; every device starts with "main".' };

export const day: JsonSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "A local day, such as 2026-11-10." };

export const month: JsonSchema = { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", description: "A month, such as 2026-11." };

export const amount: JsonSchema = { type: "number", description: "An amount in the budget's currency, rounded to the decimal places set; never negative in practice." };

export const json_file: JsonSchema = { type: "string", description: "The whole file's text." };
