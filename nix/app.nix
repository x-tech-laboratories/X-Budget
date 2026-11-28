# X-Budget as X-App's Nix lib builds it; the flake and shell.nix both read it.
{
  name = "x-budget";
  display_name = "X-Budget";
  env_prefix = "X_BUDGET";
  src = ../.;
  description = "Budgets, monthly transactions and reports, synced through your own server";
  module_description = "a web app for budgets and monthly transactions that its devices sync with";
  desktop_comment = "Budgets, monthly transactions and reports";
  port = 7740;
  database_file = "budget.db";
  sync_example = "https://budget.example.org/api/";
}
