# The flake's dev shell for nix-shell, with X-App's lib at the version flake.lock pins.
{ pkgs ? import <nixpkgs> { } }:

let
  pinned = (builtins.fromJSON (builtins.readFile ./flake.lock)).nodes.x-app.locked;
  x_app = builtins.fetchTarball "https://github.com/${pinned.owner}/${pinned.repo}/archive/${pinned.rev}.tar.gz";
in
(import "${x_app}/nix/lib.nix").shell pkgs (import ./app.nix)
