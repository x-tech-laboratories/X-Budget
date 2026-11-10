{
  lib,
  buildNpmPackage,
  nodejs_24,
  electron_43,
  makeWrapper,
  copyDesktopItems,
  makeDesktopItem,
}:

buildNpmPackage {
  pname = "x-budget-desktop";
  version = (lib.importJSON ../package.json).version;
  src = lib.cleanSource ../.;

  nodejs = nodejs_24;
  npmDepsHash = import ./npm-deps-hash.nix;
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
  ];

  npmBuildScript = "build:desktop";

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --no-save --ignore-scripts
    mkdir -p $out/lib/x-budget-desktop
    cp -r out package.json node_modules $out/lib/x-budget-desktop/
    makeWrapper ${lib.getExe electron_43} $out/bin/x-budget-desktop \
      --add-flags $out/lib/x-budget-desktop \
      --unset ELECTRON_RUN_AS_NODE

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "x-budget";
      desktopName = "X-Budget";
      comment = "Budgets, monthly transactions and reports";
      exec = "x-budget-desktop";
      categories = [ "Utility" ];
    })
  ];

  meta = {
    description = "X-Budget as a desktop app with its own database";
    license = lib.licenses.gpl3Plus;
    mainProgram = "x-budget-desktop";
  };
}
