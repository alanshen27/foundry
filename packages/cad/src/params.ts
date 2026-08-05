/**
 * Visual-editing bridge for KCL: top-level bindings like `width = 60` (before
 * the first modeling statement) become controls in the model editor.
 */

export type CadParam = {
  name: string;
  value: number | boolean | string;
  /** Absolute offsets of the value literal in the script source. */
  start: number;
  end: number;
};

const ASSIGNMENT_RE =
  /^([A-Za-z_][\w]*)\s*=\s*(-?\d+(?:\.\d+)?|true|false|"(?:[^"\\]|\\.)*")\s*(?:\/\/.*)?$/;

/** Collect consecutive top-level assignments after leading comments/blank lines. */
export function parseCadParams(script: string): CadParam[] {
  const params: CadParam[] = [];
  let offset = 0;
  for (const line of script.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      offset += line.length + 1;
      continue;
    }
    const match = ASSIGNMENT_RE.exec(trimmed);
    if (!match) break;
    const [, name, literal] = match as unknown as [string, string, string];
    // Search after the `=` so a digit inside the name can't be mistaken for the
    // value: in `d1 = 1`, a plain indexOf("1") would point at the name.
    const valueStart = offset + line.indexOf(literal, line.indexOf("=") + 1);
    let value: number | boolean | string;
    if (literal === "true" || literal === "false") value = literal === "true";
    else if (literal.startsWith('"')) value = JSON.parse(literal) as string;
    else value = Number(literal);
    params.push({ name, value, start: valueStart, end: valueStart + literal.length });
    offset += line.length + 1;
  }
  return params;
}

/** Returns the script with one parameter's value literal replaced. */
export function setCadParam(
  script: string,
  name: string,
  value: number | boolean | string,
): string {
  const param = parseCadParams(script).find((p) => p.name === name);
  if (!param) return script;
  const literal = typeof value === "string" ? JSON.stringify(value) : String(value);
  return script.slice(0, param.start) + literal + script.slice(param.end);
}
