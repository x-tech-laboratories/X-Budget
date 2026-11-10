// The page: the shell around every section, the router between them, and in a browser, signing in to the server first.

// ── Imports ──────────────────────────────────────────────────────────────────

import { Fragment, useEffect } from "react";
import { create_accounts_client, type Me } from "@x-tech-laboratories/x-libs/web/accounts";
import { AccountView, UsersView } from "@x-tech-laboratories/x-libs/web/react/accounts";
import { PageHeading } from "@x-tech-laboratories/x-libs/web/react/layout";
import { Shell, use_route, type ShellSection } from "@x-tech-laboratories/x-libs/web/react/shell";
import { SignInForm, use_account } from "@x-tech-laboratories/x-libs/web/react/sign_in";
import { theme_choice } from "@x-tech-laboratories/x-libs/web/theme";

import { page } from "./api.ts";
import { page_features } from "./features.tsx";
import { SettingsView } from "./settings/SettingsView.tsx";

// ── Sections ─────────────────────────────────────────────────────────────────

const theme = theme_choice("x-budget-theme");
const brand_icon = "icon.svg";

const sections: ShellSection[] = [
  ...page_features.map((feature) => ({ id: feature.id, label: feature.label, href: `#/${feature.id}` })),
  { id: "settings", label: "Settings", href: "#/settings" },
];

// Relative, so a server behind a proxy under a folder keeps it.
const accounts = create_accounts_client({ base: "api" });

// ── Pages ────────────────────────────────────────────────────────────────────

// Signed in, in a browser: who, and how to sign out.
interface Account {
  me: Me;
  refresh: () => Promise<void>;
  sign_out: () => Promise<void>;
}

// The highest role, which manages users and the server's backups.
function is_admin(me: Me): boolean {
  return me.role === me.roles[me.roles.length - 1];
}

function AccountPage({ account }: { account: Account }) {
  return (
    <>
      <PageHeading title="Your account" subtitle={account.me.name} />
      <AccountView client={accounts} on_change={() => void account.refresh()} />
      {is_admin(account.me) && <UsersView client={accounts} me={account.me} />}
    </>
  );
}

function Pages({ account }: { account: Account | null }) {
  const route = use_route();
  const [section = page_features[0]!.id, ...rest] = route.parts;
  const feature = page_features.find((candidate) => candidate.id === section);
  const is_account = account !== null && section === "account";
  const label = feature?.label ?? (is_account ? "Your account" : "Settings");
  const view_key = route.parts.join("/");

  useEffect(() => {
    document.title = `${label} · X-Budget`;
  }, [label]);

  const view = feature ? feature.view(rest) : is_account ? <AccountPage account={account} /> : <SettingsView is_admin={account === null || is_admin(account.me)} />;
  return (
    <Shell
      brand="X-Budget"
      brand_icon={brand_icon}
      sections={sections}
      active={section}
      theme={theme}
      view_key={view_key}
      user={account ? account.me.name : undefined}
      user_href={account ? "#/account" : undefined}
      on_logout={account ? () => void account.sign_out() : undefined}
    >
      <Fragment key={view_key}>{view}</Fragment>
    </Shell>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

// A browser reaches the server's data, so it signs in; the desktop and phone apps keep their own and sign in only to sync.
function BrowserApp() {
  const { account, refresh, sign_out } = use_account(accounts);
  if (account.state === "checking") return null;
  if (account.state === "signed_out") return <SignInForm client={accounts} title="X-Budget" icon={brand_icon} on_signed_in={refresh} />;
  return <Pages account={{ me: account.me, refresh, sign_out }} />;
}

export function App() {
  return page().host === "web" ? <BrowserApp /> : <Pages account={null} />;
}
