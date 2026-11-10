{
  lib,
  buildNpmPackage,
  nodejs_24,
  makeWrapper,
}:

buildNpmPackage {
  pname = "x-budget";
  version = (lib.importJSON ../package.json).version;
  src = lib.cleanSource ../.;

  nodejs = nodejs_24;
  npmDepsHash = import ./npm-deps-hash.nix;
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  nativeBuildInputs = [ makeWrapper ];

  # Node will not run .ts files from under a node_modules folder, so the app lives in lib/x-budget.
  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --no-save --ignore-scripts

    mkdir -p $out/lib/x-budget/src $out/lib/x-budget/out
    cp -r package.json node_modules $out/lib/x-budget/
    cp -r out/web $out/lib/x-budget/out/
    cp -r src/server src/shared $out/lib/x-budget/src/

    makeWrapper ${lib.getExe nodejs_24} $out/bin/x-budget \
      --add-flags "--disable-warning=ExperimentalWarning $out/lib/x-budget/src/server/main.ts" \
      --set-default NODE_ENV production

    makeWrapper ${lib.getExe nodejs_24} $out/bin/x-budget-hash-password \
      --add-flags "--disable-warning=ExperimentalWarning $out/lib/x-budget/src/server/hash_password.ts"

    runHook postInstall
  '';

  meta = {
    description = "Budgets, monthly transactions and reports, synced through your own server";
    license = lib.licenses.gpl3Plus;
    mainProgram = "x-budget";
  };
}
