{
  description = "X-Budget — budgets, the money that moved each month and how it measured up, synced through your own server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # The Android SDK is unfree and needs its license accepted, so only the Android shell uses this package set.
        android_pkgs = import nixpkgs {
          inherit system;
          config = { allowUnfree = true; android_sdk.accept_license = true; };
        };
        android_build_tools = "35.0.0";
        android_sdk = (android_pkgs.androidenv.composeAndroidPackages {
          platformVersions = [ "36" ];
          buildToolsVersions = [ android_build_tools ];
        }).androidsdk;
      in
      {
        packages.default = pkgs.callPackage ./nix/package.nix { };
        packages.desktop = pkgs.callPackage ./nix/desktop-package.nix { };
        devShells.default = import ./shell.nix { inherit pkgs; };

        # For the phone app: `nix develop .#android`, then `npm run build:android` and `cd android && ./gradlew assembleDebug`.
        devShells.android = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 android_pkgs.jdk21 android_sdk ];
          shellHook = ''
            export ELECTRON_SKIP_BINARY_DOWNLOAD=1
            export ANDROID_HOME="${android_sdk}/libexec/android-sdk"
            export ANDROID_SDK_ROOT="$ANDROID_HOME"
            export JAVA_HOME="${android_pkgs.jdk21.home}"
            # Gradle fetches its own aapt2, which cannot run on NixOS, so it is pointed at the SDK's.
            export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=$ANDROID_HOME/build-tools/${android_build_tools}/aapt2"
          '';
        };
      }
    ) // {
      nixosModules.default = import ./nix/module.nix self;
    };
}
