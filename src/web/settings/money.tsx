// The Money section under General in Settings: the currency, the locale numbers are written in, and decimal places.

// ── Imports ──────────────────────────────────────────────────────────────────

import type { PageSettingsProps } from "@x-tech-laboratories/x-app/app/web/app_page";
import { currency_options, format_money, money_decimals } from "@x-tech-laboratories/x-app/money";
import { CommitInput, NumberField, Select } from "@x-tech-laboratories/x-app/web/react/controls";
import { SettingRow, type SettingsSection } from "@x-tech-laboratories/x-app/web/react/layout";

// ── Money ────────────────────────────────────────────────────────────────────

export function money_settings({ settings, set_setting }: PageSettingsProps): SettingsSection[] {
  const currency = String(settings.currency || "USD");
  const locale = String(settings.locale ?? "");
  const decimals = money_decimals(settings.decimals);
  const options = currency_options(locale || undefined);
  return [{
    id: "money",
    heading: "Money",
    hint: `Amounts look like ${format_money(-1234.5, { currency, locale, decimals })}.`,
    content: (
      <>
        <SettingRow label="Currency">
          <Select label="Currency" bare options={options.some(([code]) => code === currency) ? options : [[currency, currency], ...options]} value={currency} on_change={(code) => void set_setting("currency", code)} />
        </SettingRow>
        <SettingRow label="Locale" hint="Such as en-US or en-JM, for how numbers and months are written. Empty uses this device's." as_label>
          <CommitInput
            type="text"
            placeholder="This device's"
            value={locale}
            on_commit={(event) => {
              const next = event.currentTarget.value.trim();
              if (next !== locale) void set_setting("locale", next);
            }}
          />
        </SettingRow>
        <SettingRow label="Decimal places" hint="Amounts are kept and shown with this many; typing more rounds to it. 0 budgets in whole units.">
          <NumberField bare label="Decimal places" value={decimals} min={0} max={6} on_change={(value) => value !== null && value !== decimals && void set_setting("decimals", Math.round(value))} />
        </SettingRow>
      </>
    ),
  }];
}
