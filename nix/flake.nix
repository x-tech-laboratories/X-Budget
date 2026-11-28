{
  description = "X-Budget — budgets, the money that moved each month and how it measured up, synced through your own server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    x-app.url = "github:x-tech-laboratories/X-App";
  };

  outputs = { self, nixpkgs, flake-utils, x-app }:
    let
      app = import ./app.nix;
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        packages.default = x-app.lib.package pkgs app;
        packages.desktop = x-app.lib.desktop_package pkgs app;
        devShells.default = x-app.lib.shell pkgs app;
        devShells.android = x-app.lib.android_shell nixpkgs system;
      }
    ) // {
      nixosModules.default = x-app.lib.module self app;
    };
}
