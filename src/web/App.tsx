// The page: the shell around every section, and the router between them.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Fragment, useEffect } from "react";
import { Shell, use_route, type ShellSection } from "@x-tech-laboratories/x-libs/web/react/shell";
import { theme_choice } from "@x-tech-laboratories/x-libs/web/theme";

import { page_features } from "./features.tsx";
import { SettingsView } from "./settings/SettingsView.tsx";

// ── Sections ─────────────────────────────────────────────────────────────────

const theme = theme_choice("x-budget-theme");

const sections: ShellSection[] = [
  ...page_features.map((feature) => ({ id: feature.id, label: feature.label, href: `#/${feature.id}` })),
  { id: "settings", label: "Settings", href: "#/settings" },
];

// ── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const route = use_route();
  const [section = page_features[0]!.id, ...rest] = route.parts;
  const feature = page_features.find((candidate) => candidate.id === section);
  const label = feature?.label ?? "Settings";
  const view_key = route.parts.join("/");

  useEffect(() => {
    document.title = `${label} · X-Budget`;
  }, [label]);

  return (
    <Shell brand="X-Budget" sections={sections} active={section} theme={theme} view_key={view_key}>
      <Fragment key={view_key}>{feature ? feature.view(rest) : <SettingsView />}</Fragment>
    </Shell>
  );
}
