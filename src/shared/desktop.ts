// The desktop app's own settings, kept by its daemon beside the database rather than synced, since they belong to this
// computer: running on with the window closed, and starting at login.

// ── Settings ─────────────────────────────────────────────────────────────────

export interface DesktopSettings {
  keep_running_in_background: boolean;
  start_at_login: boolean;
}

export const desktop_setting_defaults: DesktopSettings = {
  keep_running_in_background: true,
  start_at_login: true,
};

// Settings saved on the device, each default where it is missing or damaged.
export function read_desktop_settings(saved: unknown): DesktopSettings {
  const settings = (saved ?? {}) as Partial<Record<keyof DesktopSettings, unknown>>;
  const flag = (key: keyof DesktopSettings): boolean => (typeof settings[key] === "boolean" ? settings[key] : desktop_setting_defaults[key]);
  return { keep_running_in_background: flag("keep_running_in_background"), start_at_login: flag("start_at_login") };
}

// ── Calls ────────────────────────────────────────────────────────────────────

// What the page asks of the desktop app; quitting completely also stops the daemon.
export interface DesktopMethods {
  get_desktop_settings: () => DesktopSettings;
  set_desktop_setting: <Key extends keyof DesktopSettings>(key: Key, value: DesktopSettings[Key]) => void;
  quit_completely: () => void;
}

export const desktop_method_names = ["get_desktop_settings", "set_desktop_setting", "quit_completely"] as const satisfies readonly (keyof DesktopMethods)[];

// What the daemon answers about itself: its settings, and stopping.
export interface DaemonMethods {
  get_desktop_settings: () => DesktopSettings;
  set_desktop_setting: (key: keyof DesktopSettings, value: boolean) => void;
  stop_daemon: () => void;
}

export const daemon_method_names = ["get_desktop_settings", "set_desktop_setting", "stop_daemon"] as const satisfies readonly (keyof DaemonMethods)[];
