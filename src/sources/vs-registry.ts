import { exec } from "child_process";
import { promisify } from "util";
import { getPreferenceValues, environment } from "@raycast/api";
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import { randomUUID } from "crypto";
import { VsProject } from "../types";

const execAsync = promisify(exec);

const LOCAL_APP_DATA =
  process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");

function debug(...args: unknown[]) {
  console.log("[VS-MRU]", ...args);
}

// ─── 1. ApplicationPrivateSettings.xml parser ─────────────

interface TrackingEntry {
  Key: string;
  Value: {
    LocalProperties?: {
      FullPath?: string;
      Type?: number; // 0=sln, 1=folder, etc
    };
    IsFavorite?: boolean;
    LastAccessed?: string;
    IsLocal?: boolean;
  };
}

function findAppPrivateSettingsDirs(): string[] {
  const dirs: string[] = [];

  // 1. Preferencia de Raycast (si el usuario configuró una ruta)
  try {
    const { vsSettingsPath } = getPreferenceValues<{
      vsSettingsPath: string;
    }>();
    if (vsSettingsPath && vsSettingsPath.trim()) {
      const trimmed = vsSettingsPath.trim();
      if (existsSync(trimmed)) {
        debug(`Usando ruta de preferencia: ${trimmed}`);
        dirs.push(trimmed);
        return dirs;
      } else {
        debug(`Ruta configurada no existe: ${trimmed}`);
      }
    }
  } catch {
    // getPreferenceValues puede fallar en desarrollo
  }

  // 2. Auto-detección: escanea %LOCALAPPDATA%\Microsoft\VisualStudio\*
  const vsBase = join(LOCAL_APP_DATA, "Microsoft", "VisualStudio");
  if (!existsSync(vsBase)) return dirs;

  try {
    const entries = readdirSync(vsBase, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const xmlPath = join(
          vsBase,
          entry.name,
          "ApplicationPrivateSettings.xml",
        );
        if (existsSync(xmlPath)) {
          dirs.push(xmlPath);
        }
      }
    }
  } catch {
    // skip
  }
  return dirs;
}

function parseCodeContainers(xmlPath: string): VsProject[] {
  const projects: VsProject[] = [];
  try {
    const raw = readFileSync(xmlPath, "utf-8");

    // Find CodeContainers.Offline collection — JSON con MRU de proyectos/soluciones
    const valueMatch = raw.match(
      /<collection\s+name="CodeContainers\.Offline"[^>]*>[\s\S]*?<value\s+name="value">(.*?)<\/value>/s,
    );
    if (!valueMatch) {
      debug(`  No CodeContainers.Offline found in ${xmlPath}`);
      return projects;
    }

    const rawJson = valueMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&apos;/g, "'");

    if (!rawJson.startsWith("[") || !rawJson.endsWith("]")) {
      debug(`  CodeContainers.Offline value is not a JSON array`);
      return projects;
    }

    let entries: TrackingEntry[];
    try {
      entries = JSON.parse(rawJson) as TrackingEntry[];
    } catch {
      debug(`  Failed to parse CodeContainers.Offline JSON in ${xmlPath}`);
      return projects;
    }

    debug(
      `  Parsed ${entries.length} CodeContainers.Offline entries from ${xmlPath}`,
    );

    for (const entry of entries) {
      const props = entry.Value?.LocalProperties;
      const fullPath = props?.FullPath || entry.Key;
      if (!fullPath) continue;

      const ext = fullPath.split(".").pop()?.toLowerCase() || "";
      const isSln = ext === "sln";
      const isProject = [
        "csproj",
        "vbproj",
        "fsproj",
        "vcxproj",
        "pyproj",
        "prj",
      ].includes(ext);

      const name =
        fullPath
          .replace(/\\/g, "/")
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") || "Unknown";

      const lastAccessed = entry.Value?.LastAccessed
        ? new Date(entry.Value.LastAccessed).toISOString()
        : new Date().toISOString();

      // Solo últimos 6 meses
      const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
      if (new Date(lastAccessed).getTime() < sixMonthsAgo) continue;

      projects.push({
        id: randomUUID(),
        name,
        path: fullPath,
        type: isSln || isProject ? "sln" : "folder",
        lastOpened: lastAccessed,
        openCount: 1,
        pinned: entry.Value?.IsFavorite === true,
        tags: [],
      });
    }
  } catch (e) {
    debug(`  Error parsing ${xmlPath}:`, e);
  }
  return projects;
}

// ─── 2. Registry MRU (secondary source, async) ────────────

async function regQuery(key: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`reg query "${key}" /s`, {
      timeout: 3000,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function readRegistryMRU(version: string): Promise<string[]> {
  const paths: string[] = [];
  const keys = [
    `HKCU\\Software\\Microsoft\\VisualStudio\\${version}\\ProjectMRUList`,
    `HKCU\\Software\\Microsoft\\VisualStudio\\${version}\\MRUItems`,
    `HKCU\\Software\\Microsoft\\VisualStudio\\${version}_Config\\ProjectMRUList`,
  ];

  const results = await Promise.all(keys.map((key) => regQuery(key)));
  for (const out of results) {
    if (!out) continue;
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      const match = trimmed.match(
        /^(?:Item|File|MRUItem)\d+\s+REG_\w+\s+(.+)$/,
      );
      if (match) {
        const p = match[1].trim();
        if (p && !paths.includes(p)) paths.push(p);
      }
    }
  }
  return paths;
}

// ─── 3. Fallback: scan user dev folders for .sln files ────

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".vs",
  "bin",
  "obj",
  "packages",
  ".venv",
  "__pycache__",
  ".idea",
  ".vscode",
  ".terraform",
  ".next",
  ".nuxt",
  "bower_components",
  "vendor",
  "third_party",
  ".tox",
  ".eggs",
  "egg-info",
  "dist",
  "build",
  ".cache",
  ".yarn",
  ".pnp",
]);

function scanDirForSln(
  dirPath: string,
  depth: number,
  maxDepth: number,
  paths: string[],
): void {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    try {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
        scanDirForSln(join(dirPath, entry.name), depth + 1, maxDepth, paths);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".sln")) {
        paths.push(join(dirPath, entry.name));
      }
    } catch {
      // skip
    }
  }
}

/** Rutas extra configuradas por el usuario en Preferencias (separadas por ;) */
function getCustomScanPaths(): string[] {
  const out: string[] = [];
  try {
    const { customVSPaths } = getPreferenceValues<{ customVSPaths: string }>();
    if (customVSPaths && customVSPaths.trim()) {
      for (const raw of customVSPaths.split(";")) {
        const p = raw.trim();
        if (p && !out.includes(p)) out.push(p);
      }
    }
  } catch {
    // getPreferenceValues puede fallar en desarrollo
  }
  return out;
}

function scanUserDevFolders(): string[] {
  const paths: string[] = [];
  const scanDirs = [
    ...getCustomScanPaths(),
    join(homedir(), "source", "repos"),
    join(homedir(), "source"),
    join(homedir(), "projects"),
    join(homedir(), "repos"),
    join(homedir(), "Documents", "Visual Studio"),
  ];
  for (const drive of ["C:", "D:", "E:", "F:"]) {
    scanDirs.push(join(drive, "Projects"));
    scanDirs.push(join(drive, "Source"));
    scanDirs.push(join(drive, "Repos"));
    scanDirs.push(join(drive, "Dev"));
    scanDirs.push(join(drive, "Code"));
    scanDirs.push(join(drive, "Work"));
  }

  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue;
    scanDirForSln(dir, 0, 4, paths);
  }
  return paths;
}

// ─── path → project ──────────────────────────────────────

function pathToProject(filePath: string): VsProject | null {
  try {
    const normalized = filePath.replace(/\\/g, "/");
    const isSln = normalized.toLowerCase().endsWith(".sln");
    const isDir =
      !isSln && existsSync(filePath) && statSync(filePath).isDirectory();
    if (!isSln && !isDir) return null;

    const name = isSln
      ? (normalized
        .split("/")
        .pop()
        ?.replace(/\.sln$/i, "") ?? "Unknown")
      : (normalized.split("/").pop() ?? "Unknown");

    let lastOpened: string;
    try {
      lastOpened = new Date(statSync(filePath).mtimeMs).toISOString();
    } catch {
      lastOpened = new Date().toISOString();
    }

    return {
      id: randomUUID(),
      name,
      path: filePath,
      type: isSln ? "sln" : "folder",
      lastOpened,
      openCount: 1,
      pinned: false,
      tags: [],
    };
  } catch {
    return null;
  }
}

// ─── source cache (mtimes de XML) ───────────────────────

interface SourceCacheEntry {
  path: string;
  mtime: number;
}

interface SourceCache {
  xmlFiles: SourceCacheEntry[];
}

const SOURCE_CACHE_FILE = "vs2026-source-cache.json";

function getSourceCachePath(): string {
  return join(environment.supportPath, SOURCE_CACHE_FILE);
}

function getXmlTimestamps(): SourceCacheEntry[] {
  const xmlPaths = findAppPrivateSettingsDirs();
  return xmlPaths.map((p) => ({
    path: p,
    mtime: statSync(p).mtimeMs,
  }));
}

function loadSourceCache(): SourceCache | null {
  const cachePath = getSourceCachePath();
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as SourceCache;
  } catch {
    return null;
  }
}

function saveSourceCache(entries: SourceCacheEntry[]): void {
  try {
    writeFileSync(
      getSourceCachePath(),
      JSON.stringify({ xmlFiles: entries }, null, 2),
      "utf-8",
    );
  } catch {
    // no crítico
  }
}

/** ¿Los XML siguen igual que la última vez que se leyeron? */
export function areSourcesUnchanged(): boolean {
  if (platform() !== "win32") return false;
  try {
    const current = getXmlTimestamps();
    if (current.length === 0) return false;
    const cached = loadSourceCache();
    if (!cached || cached.xmlFiles.length !== current.length) return false;
    for (let i = 0; i < current.length; i++) {
      if (
        current[i].path !== cached.xmlFiles[i].path ||
        current[i].mtime !== cached.xmlFiles[i].mtime
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Guarda los mtimes actuales como referencia para próximas llamadas */
export function markSourcesAsChecked(): void {
  try {
    saveSourceCache(getXmlTimestamps());
  } catch {
    // no crítico
  }
}

// ─── main entry (async) ─────────────────────────────────

export async function gatherVSProjects(): Promise<VsProject[]> {
  if (platform() !== "win32") return [];
  const seen = new Map<string, VsProject>();

  // 1. PRIMARY: parse ApplicationPrivateSettings.xml from all VS versions
  const xmlDirs = findAppPrivateSettingsDirs();
  debug(`Found ${xmlDirs.length} ApplicationPrivateSettings.xml files`);

  for (const xmlPath of xmlDirs) {
    debug(`Parsing: ${xmlPath}`);
    const entries = parseCodeContainers(xmlPath);
    for (const e of entries) {
      if (!seen.has(e.path)) seen.set(e.path, e);
    }
  }

  // 2. SECONDARY: registry MRU for any additional entries (async)
  const versions = ["18.0", "17.0", "16.0", "15.0"];
  const regResults = await Promise.all(versions.map(readRegistryMRU));
  for (const regPaths of regResults) {
    for (const p of regPaths) {
      if (!seen.has(p)) {
        const proj = pathToProject(p);
        if (proj) seen.set(proj.path, proj);
      }
    }
  }

  // 3. FALLBACK: if still empty, scan user dev folders (with depth limit + exclusions)
  if (seen.size === 0) {
    debug("No projects from XML/registry, scanning dev folders...");
    const slnPaths = scanUserDevFolders();
    for (const p of slnPaths) {
      if (!seen.has(p)) {
        const proj = pathToProject(p);
        if (proj) seen.set(proj.path, proj);
      }
    }
  }

  const result = Array.from(seen.values());
  debug(`Total projects: ${result.length}`);

  // Escribir config.json con la ruta usada (para referencia manual)
  writeConfigJson(xmlDirs);

  return result;
}

// ─── config.json (para edición manual) ──────────────────

function writeConfigJson(xmlDirs: string[]): void {
  try {
    const configPath = join(environment.supportPath, "vs-mru-config.json");
    const config = {
      _descripcion:
        "Configuración de orígenes de datos para VS2026 Recent Projects. Cambia 'vsSettingsPath' para apuntar a otro fichero XML.",
      _como_cambiar:
        "Edita este fichero o usa Preferencias del comando en Raycast → VS Settings XML path",
      fuentes: {
        applicationPrivateSettingsXml:
          xmlDirs.length > 0 ? xmlDirs : ["(auto-detectado - no encontrado)"],
        registroWindows: [
          "HKCU\\Software\\Microsoft\\VisualStudio\\<version>\\ProjectMRUList",
        ],
        escaneoAdicional: [
          "%USERPROFILE%\\source",
          "%USERPROFILE%\\projects",
          "X:\\Projects",
          "X:\\Source",
        ],
      },
      filtros: {
        ultimosNMeses: 6,
        soloExistenteEnDisco: false,
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // no crítico
  }
}
