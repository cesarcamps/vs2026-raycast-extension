import { environment } from "@raycast/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { VsProject, SCORE_WEIGHTS } from "../types";
import {
  gatherVSProjects,
  areSourcesUnchanged,
  markSourcesAsChecked,
} from "../sources/vs-registry";

// ─── types ─────────────────────────────────────────────────

interface StoreData {
  version: number;
  projects: StoredProject[];
}

interface StoredProject {
  id: string;
  name: string;
  path: string;
  type: "sln" | "folder";
  lastOpened: string;
  openCount: number;
  pinned: boolean;
  tags: string[];
}

const STORE_VERSION = 1;

// ─── init & load ───────────────────────────────────────────

let _data: StoreData | null = null;
let _ready = false;
let _initPromise: Promise<void> | null = null;
let _dirty = false;

function getStorePath(): string {
  const supportPath = environment.supportPath;
  if (!existsSync(supportPath)) {
    mkdirSync(supportPath, { recursive: true });
  }
  return join(supportPath, "vs2026-projects.json");
}

function loadStore(): StoreData {
  const path = getStorePath();
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      return JSON.parse(raw) as StoreData;
    } catch {
      // Corrupted — start fresh
    }
  }
  return { version: STORE_VERSION, projects: [] };
}

function saveStore(): void {
  if (!_data) return;
  writeFileSync(getStorePath(), JSON.stringify(_data, null, 2), "utf-8");
  _dirty = false;
}

// ─── debounced save (microtask) ────────────────────────────

function scheduleSave(): void {
  if (_dirty) return;
  _dirty = true;
  queueMicrotask(() => {
    if (_dirty) saveStore();
  });
}

// ─── public API ────────────────────────────────────────────

export async function initDb(): Promise<void> {
  if (_ready) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _data = loadStore();
    _ready = true;
  })();

  return _initPromise;
}

// ─── in-memory cache for importFromSources ────────────────

let _lastImportResult: { imported: number; updated: number } | null = null;
let _lastImportTime = 0;
let _pendingImport: Promise<{ imported: number; updated: number }> | null =
  null;

const IMPORT_CACHE_TTL_MS = 10_000; // 10 segundos

export async function importFromSources(options?: {
  force?: boolean;
}): Promise<{ imported: number; updated: number }> {
  if (!_data) throw new Error("Store not initialized");

  const force = options?.force === true;
  const now = Date.now();

  // Cache en memoria: si ya importamos hace menos de 10s, reusar resultado
  if (
    !force &&
    _lastImportResult &&
    now - _lastImportTime < IMPORT_CACHE_TTL_MS
  ) {
    return _lastImportResult;
  }

  // Si ya hay una importación en curso, reusar su promesa
  if (_pendingImport) return _pendingImport;

  _pendingImport = (async (): Promise<{
    imported: number;
    updated: number;
  }> => {
    try {
      // Cache de disco: si XML no cambiaron, saltar lectura completa
      if (!force && areSourcesUnchanged()) {
        _lastImportResult = { imported: 0, updated: 0 };
        _lastImportTime = Date.now();
        return _lastImportResult;
      }

      const sources = await gatherVSProjects();
      let imported = 0;
      let updated = 0;

      const pathIndex = new Map<string, StoredProject>();
      for (const p of _data.projects) {
        pathIndex.set(p.path.toLowerCase(), p);
      }

      for (const src of sources) {
        const existing = pathIndex.get(src.path.toLowerCase());
        if (existing) {
          // Update
          if (src.lastOpened > existing.lastOpened) {
            existing.lastOpened = src.lastOpened;
          }
          existing.openCount += 1;
          existing.name = src.name;
          existing.type = src.type;
          updated++;
        } else {
          // Insert
          const stored: StoredProject = {
            id: src.id,
            name: src.name,
            path: src.path,
            type: src.type,
            lastOpened: src.lastOpened,
            openCount: src.openCount,
            pinned: false,
            tags: [],
          };
          _data.projects.push(stored);
          pathIndex.set(src.path.toLowerCase(), stored);
          imported++;
        }
      }

      if (imported > 0 || updated > 0) scheduleSave();

      // Cache: guardar mtimes actuales como referencia
      markSourcesAsChecked();

      _lastImportResult = { imported, updated };
      _lastImportTime = Date.now();
      return _lastImportResult;
    } finally {
      _pendingImport = null;
    }
  })();

  return _pendingImport;
}

/** Re-importa desde VS ignorando las caches (TTL en memoria y mtimes de XML). */
export async function refreshFromSources(): Promise<{
  imported: number;
  updated: number;
}> {
  return importFromSources({ force: true });
}

function computeScore(p: StoredProject): number {
  const now = Date.now();
  const lastOpenedMs = new Date(p.lastOpened).getTime();
  const daysSinceOpened = (now - lastOpenedMs) / 86400000;
  return (
    (p.pinned ? SCORE_WEIGHTS.PINNED_BONUS : 0) +
    daysSinceOpened * SCORE_WEIGHTS.LAST_OPENED_DAYS +
    p.openCount * SCORE_WEIGHTS.OPEN_COUNT
  );
}

function getSortedProjects(): StoredProject[] {
  if (!_data) return [];
  return [..._data.projects].sort((a, b) => {
    // Pinned first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    // Then by hybrid score
    return computeScore(b) - computeScore(a);
  });
}

export function getAllProjects(limit = 200): VsProject[] {
  const sorted = getSortedProjects().slice(0, limit);
  return sorted.map(storedToProject);
}

export function searchProjects(filter: string): VsProject[] {
  const trimmed = filter.trim().toLowerCase();
  if (!_data) return [];

  let filtered: StoredProject[];

  const tagMatch = trimmed.match(/^tag:\s*"?([^"]+)"?$/);
  if (tagMatch) {
    const tag = tagMatch[1].toLowerCase();
    filtered = _data.projects.filter((p) =>
      p.tags.some((t) => t.toLowerCase() === tag),
    );
  } else {
    const usedMatch = trimmed.match(/^used:\s*(?:last)?(\d+)\s*days?$/);
    if (usedMatch) {
      const days = parseInt(usedMatch[1], 10);
      const cutoff = Date.now() - days * 86400000;
      filtered = _data.projects.filter(
        (p) => new Date(p.lastOpened).getTime() >= cutoff,
      );
    } else {
      // Plain text — Raycast fuzzy handles the rest; return all sorted
      return getAllProjects();
    }
  }

  return filtered
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (
        new Date(b.lastOpened).getTime() - new Date(a.lastOpened).getTime()
      );
    })
    .map(storedToProject);
}

export function togglePinned(id: string): boolean {
  const p = findProject(id);
  if (!p) return false;
  p.pinned = !p.pinned;
  scheduleSave();
  return true;
}

export function setPinned(id: string, value: boolean): boolean {
  const p = findProject(id);
  if (!p) return false;
  p.pinned = value;
  scheduleSave();
  return true;
}

export function updateTags(id: string, tags: string[]): boolean {
  const p = findProject(id);
  if (!p) return false;
  p.tags = tags;
  scheduleSave();
  return true;
}

export function recordOpen(id: string): void {
  const p = findProject(id);
  if (!p) return;
  p.openCount += 1;
  p.lastOpened = new Date().toISOString();
  scheduleSave();
}

export function getProjectById(id: string): VsProject | null {
  const p = findProject(id);
  return p ? storedToProject(p) : null;
}

export function getProjectByPath(path: string): VsProject | null {
  if (!_data) return null;
  const p = _data.projects.find(
    (p) => p.path.toLowerCase() === path.toLowerCase(),
  );
  return p ? storedToProject(p) : null;
}

export function closeDb(): void {
  if (_dirty) saveStore();
  _data = null;
  _ready = false;
  _initPromise = null;
}

/** Escribe el store completo en la ruta indicada. Devuelve nº de proyectos. */
export function exportStore(targetPath: string): number {
  if (!_data) throw new Error("Store not initialized");
  if (_dirty) saveStore();
  writeFileSync(targetPath, JSON.stringify(_data, null, 2), "utf-8");
  return _data.projects.length;
}

function isValidStoredProject(p: unknown): p is StoredProject {
  if (!p || typeof p !== "object") return false;
  const s = p as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.path === "string" &&
    (s.type === "sln" || s.type === "folder") &&
    typeof s.lastOpened === "string" &&
    typeof s.openCount === "number" &&
    typeof s.pinned === "boolean" &&
    Array.isArray(s.tags)
  );
}

/**
 * Reemplaza el store actual con el contenido del backup indicado.
 * Devuelve el nº de proyectos importados. Lanza error si el archivo es inválido.
 */
export function importStore(sourcePath: string): number {
  const raw = readFileSync(sourcePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("El archivo no es un JSON válido");
  }
  const store = parsed as Partial<StoreData>;
  if (!store || !Array.isArray(store.projects)) {
    throw new Error(
      "El archivo no contiene un store válido (falta 'projects')",
    );
  }
  const projects = store.projects.filter(isValidStoredProject);
  _data = { version: STORE_VERSION, projects };
  saveStore();
  return projects.length;
}

// ─── helpers ───────────────────────────────────────────────

function findProject(id: string): StoredProject | undefined {
  return _data?.projects.find((p) => p.id === id);
}

function storedToProject(s: StoredProject): VsProject {
  return {
    id: s.id,
    name: s.name,
    path: s.path,
    type: s.type,
    lastOpened: s.lastOpened,
    openCount: s.openCount,
    pinned: s.pinned,
    tags: [...s.tags],
  };
}
