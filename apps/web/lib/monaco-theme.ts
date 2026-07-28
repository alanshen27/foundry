import type { Monaco } from "@monaco-editor/react";

/**
 * Foundry syntax highlighting: the brand palette (ink / off-white / signal
 * orange, with the chart hues for strings, numbers, and types) instead of
 * Monaco's stock vs themes.
 */

export const FOUNDRY_MONACO_LIGHT = "foundry-light";
export const FOUNDRY_MONACO_DARK = "foundry-dark";

const LIGHT_RULES = [
  { token: "", foreground: "0c0c0c" },
  { token: "comment", foreground: "8a867c", fontStyle: "italic" },
  { token: "keyword", foreground: "ff5a00" },
  { token: "keyword.flow", foreground: "ff5a00" },
  { token: "operator", foreground: "0c0c0c" },
  { token: "delimiter", foreground: "6b6860" },
  { token: "string", foreground: "0d9488" },
  { token: "string.escape", foreground: "0d9488", fontStyle: "bold" },
  { token: "regexp", foreground: "0d9488" },
  { token: "number", foreground: "5b6cff" },
  { token: "constant", foreground: "5b6cff" },
  { token: "type", foreground: "e11d48" },
  { token: "type.identifier", foreground: "e11d48" },
  { token: "identifier", foreground: "0c0c0c" },
  { token: "function", foreground: "0c0c0c", fontStyle: "bold" },
  { token: "variable", foreground: "0c0c0c" },
  { token: "tag", foreground: "ff5a00" },
  { token: "attribute.name", foreground: "e11d48" },
  { token: "attribute.value", foreground: "0d9488" },
  { token: "metatag", foreground: "6b6860" },
  { token: "annotation", foreground: "6b6860" },
  { token: "key", foreground: "e11d48" },
  { token: "string.key.json", foreground: "e11d48" },
  { token: "string.value.json", foreground: "0d9488" },
];

const DARK_RULES = [
  { token: "", foreground: "f4f2ec" },
  { token: "comment", foreground: "8a867c", fontStyle: "italic" },
  { token: "keyword", foreground: "ff7a33" },
  { token: "keyword.flow", foreground: "ff7a33" },
  { token: "operator", foreground: "f4f2ec" },
  { token: "delimiter", foreground: "9a968c" },
  { token: "string", foreground: "2dd4bf" },
  { token: "string.escape", foreground: "2dd4bf", fontStyle: "bold" },
  { token: "regexp", foreground: "2dd4bf" },
  { token: "number", foreground: "7b87ff" },
  { token: "constant", foreground: "7b87ff" },
  { token: "type", foreground: "fb7185" },
  { token: "type.identifier", foreground: "fb7185" },
  { token: "identifier", foreground: "f4f2ec" },
  { token: "function", foreground: "f4f2ec", fontStyle: "bold" },
  { token: "variable", foreground: "f4f2ec" },
  { token: "tag", foreground: "ff7a33" },
  { token: "attribute.name", foreground: "fb7185" },
  { token: "attribute.value", foreground: "2dd4bf" },
  { token: "metatag", foreground: "9a968c" },
  { token: "annotation", foreground: "9a968c" },
  { token: "key", foreground: "fb7185" },
  { token: "string.key.json", foreground: "fb7185" },
  { token: "string.value.json", foreground: "2dd4bf" },
];

const LIGHT_COLORS: Record<string, string> = {
  "editor.background": "#faf9f5",
  "editor.foreground": "#0c0c0c",
  "editorLineNumber.foreground": "#b8b4aa",
  "editorLineNumber.activeForeground": "#ff5a00",
  "editorCursor.foreground": "#ff5a00",
  "editor.selectionBackground": "#ff5a0026",
  "editor.inactiveSelectionBackground": "#ff5a0014",
  "editor.lineHighlightBackground": "#0c0c0c08",
  "editor.lineHighlightBorder": "#00000000",
  "editorIndentGuide.background1": "#d6d3cb",
  "editorIndentGuide.activeBackground1": "#b8b4aa",
  "editorWhitespace.foreground": "#d6d3cb",
  "editorBracketMatch.background": "#ff5a001f",
  "editorBracketMatch.border": "#ff5a0066",
  "editorGutter.background": "#faf9f5",
  "editorWidget.background": "#faf9f5",
  "editorWidget.border": "#d6d3cb",
  "editorSuggestWidget.selectedBackground": "#ff5a001f",
  "editorHoverWidget.background": "#faf9f5",
  "editorHoverWidget.border": "#d6d3cb",
  "scrollbarSlider.background": "#0c0c0c1a",
  "scrollbarSlider.hoverBackground": "#0c0c0c2e",
  "scrollbarSlider.activeBackground": "#ff5a0059",
};

const DARK_COLORS: Record<string, string> = {
  "editor.background": "#0c0c0c",
  "editor.foreground": "#f4f2ec",
  "editorLineNumber.foreground": "#4a473f",
  "editorLineNumber.activeForeground": "#ff7a33",
  "editorCursor.foreground": "#ff5a00",
  "editor.selectionBackground": "#ff5a0033",
  "editor.inactiveSelectionBackground": "#ff5a001a",
  "editor.lineHighlightBackground": "#f4f2ec0a",
  "editor.lineHighlightBorder": "#00000000",
  "editorIndentGuide.background1": "#1c1c1c",
  "editorIndentGuide.activeBackground1": "#3d3d3d",
  "editorWhitespace.foreground": "#1c1c1c",
  "editorBracketMatch.background": "#ff5a0029",
  "editorBracketMatch.border": "#ff5a0080",
  "editorGutter.background": "#0c0c0c",
  "editorWidget.background": "#141414",
  "editorWidget.border": "#2a2a2a",
  "editorSuggestWidget.selectedBackground": "#ff5a0029",
  "editorHoverWidget.background": "#141414",
  "editorHoverWidget.border": "#2a2a2a",
  "scrollbarSlider.background": "#f4f2ec14",
  "scrollbarSlider.hoverBackground": "#f4f2ec24",
  "scrollbarSlider.activeBackground": "#ff5a0059",
};

/** Pass as `beforeMount` on every Monaco surface so both themes exist. */
export function defineFoundryMonacoThemes(monaco: Monaco) {
  monaco.editor.defineTheme(FOUNDRY_MONACO_LIGHT, {
    base: "vs",
    inherit: true,
    rules: LIGHT_RULES,
    colors: LIGHT_COLORS,
  });
  monaco.editor.defineTheme(FOUNDRY_MONACO_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: DARK_RULES,
    colors: DARK_COLORS,
  });
}
