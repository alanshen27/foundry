/**
 * Arduino C++ → simulation sketch translation.
 *
 * The simulator runs JavaScript (see lib/sim/sketch.ts), while the firmware the
 * copilot writes is C++ (`src/main.cpp`). Keeping two hand-written sources in
 * step is the failure this module removes: the firmware is the single source of
 * truth, and the sketch the simulator executes is derived from it.
 *
 * This is a translator for a deliberate subset, not a compiler. C++ that a
 * blinky-class sketch never uses — classes, pointers, templates, libraries with
 * real internals — is rejected loudly rather than mistranslated, because a
 * silently wrong translation would make the simulation lie about the firmware.
 *
 * What it handles:
 *   - `void setup()` / `void loop()` and other free functions
 *   - typed declarations (`int x = 0;`, `const int PIN = 13;`, `uint8_t`, …)
 *   - `#define NAME value` and `#include` (dropped)
 *   - `delay()` / `delayMicroseconds()` rewritten as generator yields
 *   - `Serial.begin/print/println/printf` mapped onto the sketch's `print`
 *   - the digital/analog pin API, which the sketch runtime already provides
 */

/** Result of translating firmware into a runnable sketch. */
export type TranslationResult =
  { ok: true; source: string; warnings: string[] } | { ok: false; errors: string[] };

/** Extensions this translator accepts as firmware. */
const FIRMWARE_EXT = /\.(cpp|ino|c|cc|h|hpp)$/i;
/** Extensions the runtime executes directly, with no translation. */
const SKETCH_EXT = /\.(js|mjs)$/i;

export const isFirmwarePath = (path: string) => FIRMWARE_EXT.test(path);
export const isSketchPath = (path: string) => SKETCH_EXT.test(path);
/** Every file the simulator can run, either directly or by translation. */
export const isRunnablePath = (path: string) => isSketchPath(path) || isFirmwarePath(path);

/** Declaration types that become plain `let`. */
const TYPE_WORDS = [
  "unsigned long long",
  "unsigned long",
  "unsigned int",
  "unsigned char",
  "long long",
  "long",
  "short",
  "signed char",
  "uint8_t",
  "uint16_t",
  "uint32_t",
  "uint64_t",
  "int8_t",
  "int16_t",
  "int32_t",
  "int64_t",
  "size_t",
  "boolean",
  "bool",
  "byte",
  "word",
  "char",
  "float",
  "double",
  "int",
  "String",
  "auto",
];

/** C++ constructs with no honest JavaScript counterpart here. */
const UNSUPPORTED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\btemplate\s*</, reason: "templates" },
  { pattern: /\bclass\s+\w+/, reason: "class definitions" },
  { pattern: /\bstruct\s+\w+\s*\{/, reason: "struct definitions" },
  { pattern: /\bnew\s+\w+/, reason: "dynamic allocation" },
  { pattern: /\bmalloc\s*\(/, reason: "dynamic allocation" },
  { pattern: /->/, reason: "pointer dereferences" },
  { pattern: /\bnamespace\b/, reason: "namespaces" },
  { pattern: /\bgoto\b/, reason: "goto" },
];

/**
 * Libraries whose behaviour lives in the device, not in the sketch. Translating
 * the calls would produce a sketch that reads plausible and simulates nothing,
 * so they are reported instead — the simulation is about wiring and pin
 * semantics, and a driver that talks to hardware we do not model is out of it.
 */
const UNMODELLED_LIBRARIES = [
  "Wire",
  "SPI",
  "EEPROM",
  "Servo",
  "SoftwareSerial",
  "WiFi",
  "Adafruit_",
  "LiquidCrystal",
  "DHT",
  "OneWire",
];

/** Strips comments and string/char literals so scanning cannot trip over them. */
type Masked = { text: string; literals: string[] };

function maskLiterals(source: string): Masked {
  const literals: string[] = [];
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let literal = "";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          literal += source[i]! + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        literal += source[i];
        i++;
      }
      i++;
      // A char literal is a number in C++; keeping it a JS string would make
      // arithmetic on it silently wrong, so it is emitted as its code point.
      const slot =
        quote === "'" ? String(literal.length === 1 ? literal.charCodeAt(0) : 0) : `"${literal}"`;
      literals.push(slot);
      out += `\u0000${literals.length - 1}\u0000`;
      continue;
    }
    out += ch;
    i++;
  }
  return { text: out, literals };
}

const restoreLiterals = (text: string, literals: string[]) =>
  text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => literals[Number(index)] ?? '""');

/** Rewrites `Serial.x(...)` calls onto the sketch API's `print`. */
function translateSerial(line: string): string {
  return line
    .replace(/\bSerial\s*\.\s*begin\s*\([^;]*\)\s*;/g, "")
    .replace(/\bSerial\s*\.\s*(flush|end)\s*\([^;]*\)\s*;/g, "")
    .replace(/\bSerial\s*\.\s*available\s*\(\s*\)/g, "0")
    .replace(/\bSerial\s*\.\s*read\s*\(\s*\)/g, "-1")
    .replace(/\bSerial\s*\.\s*print(?:ln|f)?\s*\(/g, "print(");
}

/** Drops the type from a declaration, leaving a `let`/`const` binding. */
function translateDeclaration(line: string): string {
  const types = TYPE_WORDS.join("|");
  // `static`/`volatile`/`const` qualifiers, an optional type, then the name.
  const declaration = new RegExp(
    `^(\\s*)(?:(?:static|volatile|register|extern)\\s+)*(const\\s+)?(?:${types})\\s*\\**\\s+([A-Za-z_]\\w*)\\s*(\\[[^\\]]*\\])?\\s*(=|;)`,
  );
  const match = declaration.exec(line);
  if (!match) return line;
  const [, indent, isConst, name, array, tail] = match;
  const keyword = isConst ? "const" : "let";
  const rest = line.slice(match[0].length);
  if (tail === ";") {
    // `int x;` — an uninitialised C++ scalar reads as 0, and leaving it
    // `undefined` would turn arithmetic into NaN rather than a visible bug.
    return `${indent}${keyword} ${name} = ${array ? "[]" : "0"};${rest}`;
  }
  return `${indent}${keyword} ${name}${array ?? ""} =${rest}`;
}

/** Turns a C++ function header into a JS generator declaration. */
function translateFunctionHeader(line: string): string | null {
  const types = TYPE_WORDS.join("|");
  const header = new RegExp(
    `^\\s*(?:(?:static|inline)\\s+)*(?:void|${types})\\s*\\**\\s*([A-Za-z_]\\w*)\\s*\\(([^)]*)\\)\\s*\\{\\s*$`,
  );
  const match = header.exec(line);
  if (!match) return null;
  const [, name, params] = match;
  const args = (params ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && p !== "void")
    .map((p) => {
      const parts = p.replace(/[*&]/g, " ").trim().split(/\s+/);
      return parts[parts.length - 1] ?? "";
    })
    .filter(Boolean)
    .join(", ");
  return `function* ${name}(${args}) {`;
}

/**
 * Every user function becomes a generator so a `delay` anywhere still yields to
 * the engine, which means calls to them must be delegated with `yield*`.
 */
function delegateCalls(line: string, names: Set<string>): string {
  let out = line;
  for (const name of names) {
    out = out.replace(
      new RegExp(`(^|[^\\w.*])(${name})\\s*\\(`, "g"),
      (whole, prefix: string, fn: string, offset: number) => {
        const before = out.slice(0, offset + prefix.length).trimEnd();
        // Already delegated, or this is the declaration itself.
        if (before.endsWith("yield*") || before.endsWith("function*")) return whole;
        return `${prefix}yield* ${fn}(`;
      },
    );
  }
  return out;
}

/** Collects the names of functions the firmware declares. */
function functionNames(masked: string): Set<string> {
  const types = TYPE_WORDS.join("|");
  const header = new RegExp(
    `^\\s*(?:(?:static|inline)\\s+)*(?:void|${types})\\s*\\**\\s*([A-Za-z_]\\w*)\\s*\\([^)]*\\)\\s*\\{`,
    "gm",
  );
  const names = new Set<string>();
  for (const match of masked.matchAll(header)) {
    const name = match[1]!;
    if (name !== "setup" && name !== "loop") names.add(name);
  }
  return names;
}

/**
 * Translates Arduino firmware into a sketch the simulator can run.
 *
 * Failure is a first-class outcome: the caller shows the reasons rather than
 * running a half-translated program.
 */
export function translateArduino(firmware: string): TranslationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const masked = maskLiterals(firmware);

  for (const { pattern, reason } of UNSUPPORTED) {
    if (pattern.test(masked.text)) errors.push(`Unsupported C++ construct: ${reason}.`);
  }

  for (const library of UNMODELLED_LIBRARIES) {
    const used = new RegExp(`\\b${library}\\w*\\s*[.(]|#include\\s*<${library}`).test(masked.text);
    if (used) {
      warnings.push(
        `${library} is not modelled by the simulator; those calls do nothing in simulation.`,
      );
    }
  }

  const declared = functionNames(masked.text);
  const out: string[] = [];

  for (const raw of masked.text.split("\n")) {
    let line = raw;

    const include = /^\s*#\s*include\b/.exec(line);
    if (include) continue;

    const define = /^\s*#\s*define\s+([A-Za-z_]\w*)(?:\s+(.*))?$/.exec(line);
    if (define) {
      const [, name, value] = define;
      if (/\(/.test(name ?? "")) {
        errors.push(`Function-like macro ${name} is not supported.`);
        continue;
      }
      out.push(`const ${name} = ${value?.trim() ? value.trim() : "true"};`);
      continue;
    }

    if (/^\s*#/.test(line)) {
      // Conditional compilation would need a preprocessor; a dropped #if would
      // silently include the wrong branch, so it is refused.
      errors.push(`Preprocessor directive not supported: ${line.trim()}`);
      continue;
    }

    const header = translateFunctionHeader(line);
    if (header) {
      out.push(header);
      continue;
    }

    line = translateSerial(line);
    line = translateDeclaration(line);
    line = delegateCalls(line, declared);
    // `delay` must be yielded for the engine to advance its virtual clock.
    line = line.replace(/(^|[^\w.])(delay|delayMicroseconds)\s*\(/g, "$1yield $2(");
    line = line.replace(/\byield yield\b/g, "yield");

    out.push(line);
  }

  if (!/\bfunction\*\s+loop\s*\(/.test(out.join("\n")) && !/\bloop\s*\(/.test(masked.text)) {
    warnings.push("No loop() found; the simulation runs setup() only.");
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  // setup/loop are declared as generators by translateFunctionHeader only when
  // they carry a recognised return type; make the contract explicit either way.
  const body = restoreLiterals(out.join("\n"), masked.literals)
    .replace(/^\s*void\s+(setup|loop)\s*\(\s*\)\s*\{/gm, "function* $1() {")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { ok: true, source: body, warnings: [...new Set(warnings)] };
}

/**
 * Sketch source for any runnable file: firmware is translated, JavaScript is
 * used as written.
 */
export function sketchSourceFor(
  path: string,
  content: string,
): { source: string; warnings: string[]; errors: string[] } {
  if (!isFirmwarePath(path)) return { source: content, warnings: [], errors: [] };
  const result = translateArduino(content);
  return result.ok
    ? { source: result.source, warnings: result.warnings, errors: [] }
    : { source: "", warnings: [], errors: result.errors };
}
