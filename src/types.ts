export interface VsProject {
  id: string;
  name: string;
  path: string;
  type: "sln" | "folder";
  lastOpened: string; // ISO 8601
  openCount: number;
  pinned: boolean;
  tags: string[];
}

export interface VsSource {
  name: string;
  version: string;
  path: string;
}

export interface DbRow {
  id: string;
  name: string;
  path: string;
  type: string;
  lastOpened: string;
  openCount: number;
  pinned: number;
  tags: string;
}

export const SCORE_WEIGHTS = {
  LAST_OPENED_DAYS: -2, // 2 puntos de penalización por día desde último uso
  OPEN_COUNT: 15, // 15 puntos por cada apertura desde Raycast
  PINNED_BONUS: 10000, // Pinned siempre arriba
};

export function projectToRow(p: VsProject): DbRow {
  return {
    ...p,
    pinned: p.pinned ? 1 : 0,
    tags: JSON.stringify(p.tags),
  };
}

export function rowToProject(r: DbRow): VsProject {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    type: r.type as "sln" | "folder",
    lastOpened: r.lastOpened,
    openCount: r.openCount,
    pinned: r.pinned === 1,
    tags: JSON.parse(r.tags),
  };
}
