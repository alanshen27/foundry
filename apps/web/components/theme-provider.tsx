"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeToDocument,
  DEFAULT_THEME,
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemeAccent,
  type ThemeMode,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  theme: ThemePreference;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function persist(next: ThemePreference) {
  applyThemeToDocument(next);
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_THEME);

  useEffect(() => {
    const stored = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    setThemeState(stored);
    applyThemeToDocument(stored);
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    persist(next);
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    setThemeState((prev) => {
      const next = { ...prev, mode };
      persist(next);
      return next;
    });
  }, []);

  const setAccent = useCallback((accent: ThemeAccent) => {
    setThemeState((prev) => {
      const next = { ...prev, accent };
      persist(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setMode, setAccent, setTheme }),
    [theme, setMode, setAccent, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
