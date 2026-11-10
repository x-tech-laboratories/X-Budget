self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.x-budget;
  inherit (lib)
    literalExpression
    mkEnableOption
    mkIf
    mkOption
    types
    ;

  state_directory = "/var/lib/x-budget";

  config_file = (pkgs.formats.json { }).generate "x-budget.json" {
    database = "${state_directory}/budget.db";
    backups_folder = "${state_directory}/backups";
  };
in
{
  options.services.x-budget = {
    enable = mkEnableOption "X-Budget, a web app for budgets and monthly transactions that its devices sync with";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = literalExpression "x-budget (from flake)";
      description = "The X-Budget package to use.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Address the page, API and sync listen on.";
    };

    port = mkOption {
      type = types.port;
      default = 7740;
      description = "Port the page, API and sync listen on.";
    };

    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open the port in the firewall.";
    };

    adminsFile = mkOption {
      type = types.str;
      description = ''
        File of `name:hash` lines for the admins, made with `x-budget-hash-password <name> <file>`. Everyone else is
        added from the page by an admin.
      '';
    };
  };

  config = mkIf cfg.enable {
    systemd.services.x-budget = {
      description = "X-Budget";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];

      environment = {
        X_BUDGET_CONFIG = toString config_file;
        X_BUDGET_HOST = cfg.host;
        X_BUDGET_PORT = toString cfg.port;
        X_BUDGET_PASSWORD_HASH_FILE = "%d/admins";
      };

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        DynamicUser = true;
        StateDirectory = "x-budget";
        StateDirectoryMode = "0700";
        LoadCredential = [ "admins:${cfg.adminsFile}" ];
        Restart = "on-failure";
        RestartSec = "5s";

        CapabilityBoundingSet = "";
        LockPersonality = true;
        NoNewPrivileges = true;
        PrivateDevices = true;
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        SystemCallArchitectures = "native";
        SystemCallFilter = [ "@system-service" ];
        UMask = "0077";
      };
    };

    networking.firewall.allowedTCPPorts = mkIf cfg.openFirewall [ cfg.port ];
  };
}
