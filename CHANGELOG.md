# Changelog — VisualStudio2026

All notable changes to this Raycast extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] — 27 Jul 2026

### Cambios
- 🔧 `.github/workflows/build-release.yml`: build produce `visualstudio2026.raycast/` (directorio), se empaqueta en `.zip` para release descargable e instalable en Raycast sin fuente

## [1.0.0] — 2026-06-18

### Added

- **Initial release** — Raycast extension for Windows that surfaces your Visual Studio 2026 recent projects (`.sln` files and folders) in a searchable, ranked list.

- **Smart project import** from three sources:
  - **Primary:** `ApplicationPrivateSettings.xml` (CodeContainers.Offline) — parsed from all VS versions found in `%LOCALAPPDATA%\Microsoft\VisualStudio\`.
  - **Secondary:** Windows Registry MRU keys (`ProjectMRUList`, `MRUItems`) for VS 15.0–18.0.
  - **Fallback:** recursive scan of common dev folders (`~/source`, `~/projects`, `X:\Projects`, etc.).

- **Hybrid ranking** — projects sorted by pinned status + recency + open count.

- **Date-based grouping** — Today, Yesterday, This Week, This Month, Earlier + dedicated 📌 Pinned section.

- **Tag system** — add/edit tags per project, filter with `tag:net8` in search bar.

- **Time-range filter** — `used:last7days`, `used:last30days`, etc.

- **Open actions:**
  - Open with default `.sln` handler (OS association).
  - Open containing folder.
  - Open in VS Preview / VS Stable / VS Enterprise (auto-detects `devenv.exe`).
  - Copy full path to clipboard.

- **Pin / Unpin** projects to keep favorites at the top.

- **Visual polish** — deterministic pastel color per project, relative timestamps, truncated paths.

- **Source-change caching** — XML mtimes tracked; re-import skipped when sources unchanged.
