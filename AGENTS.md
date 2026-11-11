# Instructions for AI agents

X-Budget plans a budget as nested lines, records what moved each month, and measures the month against the plan. It is
a React page that runs in a browser against its own server, in Electron with its own database, and on Android in
Capacitor with its own database, all syncing through the server. Read `README.md` first, then `docs/architecture.md`.
It follows the [X-Tech Application Standard](https://x-tech-laboratories.github.io/standards/application/).

## Setup and checks

- `nix-shell` (or `nix develop`) gives Node 24 and an Electron that runs on NixOS; then `npm install`.
- `npm run typecheck`, `npm test` and `npm run lint` must pass before you propose a change.
- While working, run only the tests for what you changed (`npx vitest run tests/<file>`); CI runs the full suite.
- To look at the app, build it and run it under its own Xvfb display with `--mute-audio`, never on the user's screen.

## Rules

- The budget's rules live in `src/shared/budget/model.ts` as plain functions; the store and the page only call them.
- Code in `src/shared/` runs on the server, in Electron's main process and in the phone's page: no DOM, no `node:` imports.
- A store call that only reads is named `list_`, `get_`, `search_`, `lookup_` or `export_`; any other name announces a change.
- A released migration step is never edited; add a new step after it.
- Amounts are stored rounded to the decimal places set; money is formatted with X-Libs `money`, months with X-Libs `dates`.
- Use X-Libs widgets and Halon classes; `app.css` holds layout only and never a colour. A widget two apps could use goes into X-Libs.
- Tests use a throwaway database (`:memory:` or a temp file), never `dev-data/` or a real profile.
- Comments are one plain line saying what the code does now; names are snake_case, components PascalCase.
- Commit messages follow Conventional Commits and end with an `Assisted-by:` trailer naming the tool.
- When a task is ambiguous, stop and ask rather than guess.

## X-Tech standards

- Follow the [Application Standard](https://x-tech-laboratories.github.io/standards/application/) and the
  [Design Guidelines](https://x-tech-laboratories.github.io/standards/design/), whose source is `src/content/docs/standards/`
  in [x-tech-laboratories.github.io](https://github.com/x-tech-laboratories/x-tech-laboratories.github.io). Ask before
  changing either, since a change applies to every X-app.
- Use [X-Libs](https://github.com/x-tech-laboratories/X-Libs) and Halon ([X-Themes](https://github.com/x-tech-laboratories/X-Themes))
  before writing your own code: check the module table in the X-Libs README first.
- A feature another app could use belongs in X-Libs, or Halon for styling, with tests and a README row. If that is out
  of reach, add it to the candidates in X-Libs' `docs/TODO.md`.
