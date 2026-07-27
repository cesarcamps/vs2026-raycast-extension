import {
  ActionPanel,
  List,
  Action,
  Form,
  Icon,
  showToast,
  Toast,
  Clipboard,
  useNavigation,
  open,
} from "@raycast/api";
import { useState, useEffect, useCallback, useMemo } from "react";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { VsProject } from "./types";
import * as db from "./db/database";

const execAsync = promisify(exec);

// ─── helpers ───────────────────────────────────────────────

function groupByDate(projects: VsProject[]) {
  const now = new Date();
  const todayStr = now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const pinned: VsProject[] = [];
  const today: VsProject[] = [];
  const yesterdayGroup: VsProject[] = [];
  const thisWeek: VsProject[] = [];
  const thisMonth: VsProject[] = [];
  const older: VsProject[] = [];

  for (const p of projects) {
    if (p.pinned) {
      pinned.push(p);
      continue;
    }
    const d = new Date(p.lastOpened);
    const dStr = d.toDateString();
    if (dStr === todayStr) today.push(p);
    else if (dStr === yesterdayStr) yesterdayGroup.push(p);
    else if (d >= weekAgo) thisWeek.push(p);
    else if (d >= monthAgo) thisMonth.push(p);
    else older.push(p);
  }

  const sections: { title: string; items: VsProject[] }[] = [];
  if (pinned.length) sections.push({ title: "📌 Pinned", items: pinned });
  if (today.length) sections.push({ title: "🕒 Today", items: today });
  if (yesterdayGroup.length)
    sections.push({ title: "🕒 Yesterday", items: yesterdayGroup });
  if (thisWeek.length)
    sections.push({ title: "🕒 This Week", items: thisWeek });
  if (thisMonth.length)
    sections.push({ title: "🕒 This Month", items: thisMonth });
  if (older.length) sections.push({ title: "🕒 Earlier", items: older });

  return sections;
}

function findDevenv(
  flavor: "Stable" | "Preview" | "Enterprise",
): string | null {
  const base = "C:\\Program Files\\Microsoft Visual Studio";
  const editions: Record<string, string[]> = {
    Stable: ["2026", "2022"],
    Preview: ["2026\\Preview", "2022\\Preview"],
    Enterprise: ["2026\\Enterprise", "2022\\Enterprise"],
  };
  for (const suffix of editions[flavor]) {
    const exe = `${base}\\${suffix}\\Common7\\IDE\\devenv.exe`;
    if (existsSync(exe)) return exe;
  }
  return null;
}

const PASTEL_COLORS = [
  "#FFB5C2", // pink
  "#C9B1FF", // lavender
  "#B5D8FF", // sky blue
  "#A8E6CF", // mint
  "#FFD4A8", // peach
  "#FFDAC1", // salmon
  "#E8D5B7", // sand
  "#B5D8E6", // teal
];

function getFileIcon(proj: VsProject): { source: Icon; tintColor: string } {
  // Deterministic color from project name
  const hash = [...proj.name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const color = PASTEL_COLORS[hash % PASTEL_COLORS.length];
  return {
    source: proj.type === "sln" ? Icon.Code : Icon.Folder,
    tintColor: color,
  };
}

function shortenPath(p: string): string {
  const parts = p.split("\\");
  if (parts.length <= 3) return p;
  return "…\\" + parts.slice(-3).join("\\");
}

function getAccessory(proj: VsProject): string {
  const parts: string[] = [formatRelativeDate(proj.lastOpened)];
  if (proj.openCount > 1) parts.push(`${proj.openCount}x`);
  if (proj.tags.length > 0) parts.push(`[${proj.tags.join(", ")}]`);
  return parts.join("  ");
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// ─── actions ───────────────────────────────────────────────

async function openSolution(proj: VsProject) {
  try {
    db.recordOpen(proj.id);
    await open(proj.path);
  } catch (e) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to open",
      message: String(e),
    });
  }
}

async function openWithVS(
  proj: VsProject,
  flavor: "Stable" | "Preview" | "Enterprise",
) {
  const devenv = findDevenv(flavor);
  if (!devenv) {
    showToast({ style: Toast.Style.Failure, title: `VS ${flavor} not found` });
    return;
  }
  try {
    db.recordOpen(proj.id);
    await execAsync(`"${devenv}" "${proj.path}"`);
  } catch (e) {
    showToast({
      style: Toast.Style.Failure,
      title: `Failed to open with VS ${flavor}`,
      message: String(e),
    });
  }
}

async function openFolder(proj: VsProject) {
  try {
    const folder =
      proj.type === "sln"
        ? proj.path.substring(0, proj.path.lastIndexOf("\\"))
        : proj.path;
    await execAsync(`start "" "${folder}"`);
  } catch (e) {
    showToast({
      style: Toast.Style.Failure,
      title: "Failed to open folder",
      message: String(e),
    });
  }
}

async function copyPath(proj: VsProject) {
  await Clipboard.copy(proj.path);
  await showToast({
    style: Toast.Style.Success,
    title: "Path copied",
    message: proj.path,
  });
}

async function pinUnpin(proj: VsProject) {
  db.togglePinned(proj.id);
  await showToast({
    style: Toast.Style.Success,
    title: proj.pinned ? "Unpinned" : "Pinned",
    message: proj.name,
  });
}

// ─── Tag Editor component ──────────────────────────────────

function TagEditor({ proj, onSave }: { proj: VsProject; onSave: () => void }) {
  const { pop } = useNavigation();
  const [tagText, setTagText] = useState(proj.tags.join(", "));

  async function handleSave() {
    const tags = tagText
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    db.updateTags(proj.id, tags);
    onSave();
    await showToast({
      style: Toast.Style.Success,
      title: `Tags saved: ${tags.join(", ") || "(none)"}`,
    });
    pop();
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            icon={Icon.Tag}
            title="Save Tags"
            onSubmit={handleSave}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title={`Tags for: ${proj.name}`}
        text="Enter tags separated by commas or semicolons"
      />
      <Form.TextArea
        id="tags"
        title="Tags"
        placeholder="net8, flutter, legacy, api"
        value={tagText}
        onChange={setTagText}
      />
      <Form.Description
        title="Search with tags"
        text='Type "tag:net8" in the main search bar to filter by tag'
      />
    </Form>
  );
}

// ─── main component ────────────────────────────────────────

export default function Command() {
  const [projects, setProjects] = useState<VsProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(0);

  // Load / import on mount — two-phase for instant UI
  useEffect(() => {
    (async () => {
      try {
        // Fase 1: init DB y mostrar datos del store inmediatamente
        await db.initDb();
        refreshList();
        setIsLoading(false);

        // Fase 2: importar desde VS en segundo plano (post-render)
        // La UI ya se pintó con los datos del store, el usuario puede
        // interactuar mientras se completa la importación asíncrona.
        setTimeout(async () => {
          try {
            const { imported, updated } = await db.importFromSources();
            if (imported > 0 || updated > 0) {
              console.log(`VS import: ${imported} new, ${updated} updated`);
              refreshList();
            }
          } catch (e) {
            console.error("VS import error:", e);
          }
        }, 0);
      } catch (e) {
        console.error("Init error:", e);
        setIsLoading(false);
      }
    })();
  }, []);

  // Refresh when needsRefresh changes
  const refreshList = useCallback(() => {
    const list = db.getAllProjects();
    setProjects(list);
  }, []);

  useEffect(() => {
    if (needsRefresh > 0) refreshList();
  }, [needsRefresh]);

  // Search handling
  const filtered = useMemo(() => {
    const trimmed = searchText.trim().toLowerCase();
    if (!trimmed) return projects;

    // tag:xxx filter → DB lookup
    if (trimmed.startsWith("tag:") || trimmed.startsWith("used:")) {
      return db.searchProjects(trimmed);
    }

    // Plain text → client-side fuzzy on name + path + tags
    const terms = trimmed.split(/\s+/);
    return projects.filter((p) => {
      const name = p.name.toLowerCase();
      const path = p.path.toLowerCase();
      const tags = p.tags.join(" ").toLowerCase();
      // All terms must match somewhere
      return terms.every(
        (t) => name.includes(t) || path.includes(t) || tags.includes(t),
      );
    });
  }, [projects, searchText]);

  const sections = useMemo(() => groupByDate(filtered), [filtered]);

  const onAction = useCallback((action: string, proj: VsProject) => {
    switch (action) {
      case "open":
        openSolution(proj);
        break;
      case "folder":
        openFolder(proj);
        break;
      case "preview":
        openWithVS(proj, "Preview");
        break;
      case "stable":
        openWithVS(proj, "Stable");
        break;
      case "enterprise":
        openWithVS(proj, "Enterprise");
        break;
      case "pin":
        pinUnpin(proj).then(() => setNeedsRefresh((n) => n + 1));
        break;
      case "copy":
        copyPath(proj);
        break;
    }
  }, []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search projects…  (tag:xxx  used:last7days)"
      onSearchTextChange={setSearchText}
      throttle
    >
      {sections.map((section) => (
        <List.Section key={section.title} title={section.title}>
          {section.items.map((proj) => (
            <List.Item
              key={proj.id}
              icon={getFileIcon(proj)}
              title={proj.name}
              subtitle={shortenPath(proj.path)}
              accessories={[
                { text: getAccessory(proj) },
                ...(proj.pinned ? [{ icon: Icon.Pin }] : []),
              ]}
              actions={
                <ActionPanel>
                  <ActionPanel.Section title="Open">
                    <Action
                      icon={Icon.Play}
                      title="Open Solution / Folder"
                      onAction={() => onAction("open", proj)}
                    />
                    <Action
                      icon={Icon.Folder}
                      title="Open Containing Folder"
                      shortcut={{ modifiers: ["ctrl"], key: "return" }}
                      onAction={() => onAction("folder", proj)}
                    />
                    <Action
                      icon={Icon.Code}
                      title="Open in VS Preview"
                      shortcut={{ modifiers: ["alt"], key: "return" }}
                      onAction={() => onAction("preview", proj)}
                    />
                    <Action
                      icon={Icon.Code}
                      title="Open in VS Stable"
                      shortcut={{ modifiers: ["shift"], key: "return" }}
                      onAction={() => onAction("stable", proj)}
                    />
                    <Action
                      icon={Icon.Code}
                      title="Open in VS Enterprise"
                      shortcut={{ modifiers: ["opt", "shift"], key: "return" }}
                      onAction={() => onAction("enterprise", proj)}
                    />
                  </ActionPanel.Section>

                  <ActionPanel.Section title="Manage">
                    <Action
                      icon={proj.pinned ? Icon.Pin : Icon.PinDisabled}
                      title={proj.pinned ? "Unpin" : "Pin"}
                      shortcut={{ modifiers: ["ctrl"], key: "p" }}
                      onAction={() => onAction("pin", proj)}
                    />
                    <Action.Push
                      icon={Icon.Tag}
                      title="Edit Tags"
                      shortcut={{ modifiers: ["ctrl"], key: "t" }}
                      target={
                        <TagEditor
                          proj={proj}
                          onSave={() => setNeedsRefresh((n) => n + 1)}
                        />
                      }
                    />
                    <Action
                      icon={Icon.CopyClipboard}
                      title="Copy Path"
                      shortcut={{ modifiers: ["ctrl"], key: "c" }}
                      onAction={() => onAction("copy", proj)}
                    />
                  </ActionPanel.Section>

                  <ActionPanel.Section title="Filters">
                    <Action
                      icon={Icon.MagnifyingGlass}
                      title="Filter by Tag"
                      shortcut={{ modifiers: ["cmd"], key: "t" }}
                      onAction={() => setSearchText("tag:")}
                    />
                    <Action
                      icon={Icon.MagnifyingGlass}
                      title="Filter by Used Days"
                      shortcut={{ modifiers: ["cmd"], key: "d" }}
                      onAction={() => setSearchText("used:last7days")}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}

      {!isLoading && sections.length === 0 && (
        <List.EmptyView
          icon={Icon.Folder}
          title="No projects found"
          description="Open Visual Studio 2026 and work on some projects first, or check the search filters."
        />
      )}
    </List>
  );
}
