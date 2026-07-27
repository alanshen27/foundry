/** Bumped to move existing installs onto the lilac-on-navy default. */
export const THEME_STORAGE_KEY = "foundry-theme-v3";

export const THEME_MODES = ["dark", "light"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Accent ids. Legacy "forge"/"copper" map to signal/ember on read. */
export const THEME_ACCENTS = ["lilac", "signal", "cobalt", "graphite", "jade", "ember"] as const;
export type ThemeAccent = (typeof THEME_ACCENTS)[number];

export type ThemePreference = {
  mode: ThemeMode;
  accent: ThemeAccent;
};

/** Brand default: navy + the lavender from the mark. */
export const DEFAULT_THEME: ThemePreference = {
  mode: "dark",
  accent: "lilac",
};

export const ACCENT_LABELS: Record<ThemeAccent, string> = {
  lilac: "Lilac",
  signal: "Signal",
  cobalt: "Cobalt",
  graphite: "Graphite",
  jade: "Jade",
  ember: "Ember",
};

/** Swatch colors for the picker (not the live CSS tokens). */
export const ACCENT_SWATCHES: Record<ThemeAccent, string> = {
  lilac: "#CAB7F7",
  signal: "#0D99FF",
  cobalt: "#5B6CFF",
  graphite: "#5C6370",
  jade: "#14B8A6",
  ember: "#C97840",
};

const LEGACY_ACCENT: Record<string, ThemeAccent> = {
  forge: "signal",
  steel: "cobalt",
  copper: "ember",
  moss: "jade",
  ocean: "signal",
};

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  if (!raw) return DEFAULT_THEME;
  try {
    const parsed = JSON.parse(raw) as Partial<ThemePreference> & { accent?: string };
    const mode = THEME_MODES.includes(parsed.mode as ThemeMode)
      ? (parsed.mode as ThemeMode)
      : DEFAULT_THEME.mode;
    let accent: ThemeAccent = DEFAULT_THEME.accent;
    if (typeof parsed.accent === "string") {
      const mapped = LEGACY_ACCENT[parsed.accent] ?? parsed.accent;
      if (THEME_ACCENTS.includes(mapped as ThemeAccent)) {
        accent = mapped as ThemeAccent;
      }
    }
    return { mode, accent };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyThemeToDocument(theme: ThemePreference) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme.mode === "dark");
  root.dataset.accent = theme.accent;
}

/** Monaco built-in themes keyed to our appearance mode. */
export function monacoThemeFor(mode: ThemeMode): "vs-dark" | "light" {
  return mode === "dark" ? "vs-dark" : "light";
}

/** three.js / CAD viewport surface colors for the active mode. */
export function cadSurfaceColors(mode: ThemeMode) {
  if (mode === "dark") {
    return {
      background: "#1c222e",
      cell: "#333c4e",
      section: "#4b566d",
    };
  }
  return {
    background: "#f6f5fb",
    cell: "#d8d4e6",
    section: "#b5aecc",
  };
}
