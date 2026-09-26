import type { CadAsset, CadComponent, CadDoc } from "./port";

export const PYTHON_ASSEMBLY_PATH = "assembly/product.py";
export const PYTHON_PART_STARTER =
  "# Parametric CAD in millimetres. Assign a build123d Shape to result.\nresult = None\n";
export const PYTHON_ASSEMBLY_STARTER =
  "# Assembly has not been built. Add manufacturing parts first.\nresult = None\n";

export function isPythonCadComponent(component: Pick<CadComponent, "path">): boolean {
  return /\.py$/i.test(component.path);
}

/** Python modules use identifiers, so display-name punctuation cannot become an import. */
export function pythonPartPath(name: string): string {
  let slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "part";
  if (/^\d/.test(slug)) slug = `part_${slug}`;
  return slug === "main" ? "parts/main.py" : `parts/${slug}/main.py`;
}

export function isPythonProjectPath(path: string): boolean {
  return path.length <= 240 && /^(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(path);
}

export function pythonModuleName(path: string): string {
  if (!isPythonProjectPath(path)) throw new Error(`Invalid Python CAD module path: ${path}`);
  return path.replace(/\.py$/, "").replaceAll("/", ".");
}

/** Mask comments and strings, keeping offsets and newlines for static import discovery. */
function maskedPython(source: string): string {
  return source.replace(
    /#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g,
    (token) => token.replace(/[^\r\n]/g, " "),
  );
}

/** Resolve static Python imports against project files; third-party/stdlib imports stay external. */
export function pythonProjectDependencies(files: Record<string, string>, path: string): string[] {
  const code = maskedPython(files[path] ?? "").replace(/\\\r?\n/g, " ");
  const found = new Set<string>();
  const rootNames = new Set(
    Object.keys(files).map((file) => file.split("/")[0]!.replace(/\.py$/, "")),
  );
  const modulePath = (name: string): string | undefined => {
    const base = name.replace(/\./g, "/");
    return Object.hasOwn(files, `${base}.py`)
      ? `${base}.py`
      : Object.hasOwn(files, `${base}/__init__.py`)
        ? `${base}/__init__.py`
        : undefined;
  };
  const add = (target: string) => {
    found.add(target);
    const directories = target.split("/").slice(0, -1);
    while (directories.length) {
      const initializer = directories.join("/") + "/__init__.py";
      if (Object.hasOwn(files, initializer)) found.add(initializer);
      directories.pop();
    }
  };
  // run_module imports the entry's parent packages even if its source has no imports.
  const parents = path.split("/").slice(0, -1);
  while (parents.length) {
    const initializer = parents.join("/") + "/__init__.py";
    if (initializer !== path && Object.hasOwn(files, initializer)) add(initializer);
    parents.pop();
  }
  const resolve = (name: string, relative: boolean, optional = false) => {
    const target = modulePath(name);
    if (target) add(target);
    else if (
      !optional &&
      (relative || rootNames.has(name.split(".")[0]!) || /^(parts|assembly)(\.|$)/.test(name))
    ) {
      // A package can consist entirely of submodules without __init__.py.
      if (!Object.keys(files).some((file) => file.startsWith(name.replace(/\./g, "/") + "/")))
        throw new Error(`Missing imported Python module: ${name} (in ${path})`);
    }
  };
  for (const match of code.matchAll(
    /(?:^|[;\n])[\t ]*(?:from\s+([.\w]+)\s+import\s+(\([^)]*\)|[^;\n]+)|import\s+([^;\n]+))/g,
  )) {
    if (match[3]) {
      for (const item of match[3].split(",")) resolve(item.trim().split(/\s+as\s+/)[0]!, false);
      continue;
    }
    const raw = match[1]!;
    const dots = /^\.+/.exec(raw)?.[0].length ?? 0;
    const segments = path.split("/").slice(0, -1);
    if (dots > segments.length)
      throw new Error(`Python relative import escapes project: ${raw} (in ${path})`);
    const name = dots
      ? [...segments.slice(0, segments.length - dots + 1), raw.slice(dots)]
          .filter(Boolean)
          .join(".")
      : raw;
    resolve(name, dots > 0);
    for (const item of match[2]!.replace(/[()]/g, "").split(",")) {
      const symbol = item.trim().split(/\s+as\s+/)[0];
      if (symbol && symbol !== "*") {
        const localNamespace =
          !modulePath(name) &&
          Object.keys(files).some((file) => file.startsWith(name.replace(/\./g, "/") + "/"));
        resolve(`${name}.${symbol}`, dots > 0, !localNamespace);
      }
    }
  }
  return [...found].sort();
}

export type PythonProjectBuild = {
  files: Record<string, string>;
  entryPath: string;
  meshAssets: CadAsset[];
};

export function buildPythonProject(doc: CadDoc, entryPath: string): PythonProjectBuild {
  const all = Object.fromEntries(
    doc.components
      .filter((c) => c.kind !== "instructions" && isPythonCadComponent(c))
      .map((c) => [c.path, c.content]),
  );
  if (!Object.hasOwn(all, entryPath)) throw new Error(`Missing Python CAD entry: ${entryPath}`);
  const files: Record<string, string> = {};
  const assets = new Map<string, CadAsset>();
  const visit = (path: string) => {
    if (Object.hasOwn(files, path)) return;
    if (!isPythonProjectPath(path)) throw new Error(`Invalid Python CAD module path: ${path}`);
    files[path] = all[path]!;
    for (const dependency of pythonProjectDependencies(all, path)) visit(dependency);
    // The runner materializes authorized project assets. Literal import paths are portable;
    // dynamic filesystem discovery is deliberately not a project dependency mechanism.
    const masked = maskedPython(all[path]!);
    for (const match of all[path]!.matchAll(
      /\bimport_(?:step|brep|stl)\s*\(\s*(["'])([^"'\r\n]+)\1/g,
    )) {
      if (!masked.slice(match.index, match.index! + "import_".length).startsWith("import_"))
        continue;
      const assetPath = match[2]!;
      const asset = doc.assets?.find((a) => a.path === assetPath);
      if (!asset) throw new Error(`Missing imported CAD asset: ${assetPath} (in ${path})`);
      assets.set(asset.id, asset);
    }
  };
  visit(entryPath);
  return {
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    entryPath,
    meshAssets: [...assets.values()],
  };
}
