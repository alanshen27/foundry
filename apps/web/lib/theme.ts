/** Bumped for Nothing-inspired orange / industrial default. */
export const THEME_STORAGE_KEY = "foundry-theme-v4";

export const THEME_MODES = ["dark", "light"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Accent ids. Legacy "forge"/"copper" map to signal/ember on read. */
export const THEME_ACCENTS = ["signal", "ember", "cobalt", "graphite", "jade", "lilac"] as const;
export type ThemeAccent = (typeof THEME_ACCENTS)[number];

export type ThemePreference = {
  mode: ThemeMode;
  accent: ThemeAccent;
};

/** Brand default: off-white / black with signal orange. */
export const DEFAULT_THEME: ThemePreference = {
  mode: "light",
  accent: "signal",
};

export const ACCENT_LABELS: Record<ThemeAccent, string> = {
  signal: "Signal",
  ember: "Rose",
  cobalt: "Cobalt",
  graphite: "Graphite",
  jade: "Jade",
  lilac: "Lilac",
};

/** Swatch colors for the picker (not the live CSS tokens). */
export const ACCENT_SWATCHES: Record<ThemeAccent, string> = {
  signal: "#FF5A00",
  ember: "#E11D48",
  cobalt: "#5B6CFF",
  graphite: "#1A1A1A",
  jade: "#0D9488",
  lilac: "#CAB7F7",
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
      background: "#0c0c0c",
      cell: "#2a2a2a",
      section: "#3d3d3d",
    };
  }
  return {
    background: "#f4f2ec",
    cell: "#d9d6ce",
    section: "#b8b4aa",
  };
}
