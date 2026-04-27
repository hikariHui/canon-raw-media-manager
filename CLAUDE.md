# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm i

# Run dev (Vite frontend + Rust backend together)
pnpm tauri dev

# Build desktop app
pnpm tauri build

# Frontend only (no Tauri backend)
pnpm dev

# Type check
vue-tsc --noEmit
```

Linting/formatting run automatically via Husky on commit (oxlint + Prettier + stylelint).

## Architecture

This is a **Tauri 2 desktop app** for managing Canon RAW video files paired with proxy versions. React + TypeScript handles the UI; Rust handles filesystem and media processing.

### Frontend (`src/`)

- **`App.tsx`** — root layout: `AppHeader` + `MainWorkspace` + `OperationTips`, global Ctrl/Cmd+Z undo listener
- **`main.tsx`** — React entry, mounts `AppProvider` wrapping `App`
- **`context/AppContext.tsx`** — single Context provider that owns all shared state: raw file list, current selection, proxy file resolution, duration cache. Components read via `useAppContext()`.
- **`components/`** — `VideoList.tsx` (file sidebar with keyboard nav), `ProxyPreview.tsx` (video player), `VideoInfo.tsx` (metadata panel), `AppHeader.tsx` (directory selection), `MainWorkspace.tsx` (layout), `OperationTips.tsx` (shortcut hints)
- **`hooks/useMoveVideo.ts`** — `deleteVideo(path, proxyDir)` / `starVideo(path, proxyDir)` — moves raw + proxy + .cpf files, records undo history
- **`utils/`** — `store.ts` (Tauri persistent store wrapper), `oprationHistory.ts` (undo/redo stack), `getProxyVideoPath.ts` (raw→proxy path mapping), `getDeletedPath.ts` (trash/starred folder paths)

### UI Library

- **`animal-island-ui`** — Animal Crossing–themed React component library. Import style once at entry: `import 'animal-island-ui/style'`. Components: `Button`, `Card`, `Input`, `Switch`, `Modal`, `Collapse`, `Divider`, `Footer`, `Typewriter`, `Cursor`, `Time`, `Phone`.
- **`react-icons`** — icon set (uses `react-icons/md` for Material Design icons)

### Backend (`src-tauri/src/`)

- **`lib.rs`** — Tauri app init, registers all Tauri commands
- **`fs.rs`** — `read_directory_files`, `watch_directory` (uses `notify` crate for real-time file change events), `move_file`, `is_file_exists`
- **`ffmpeg.rs`** — `get_video_info` (FFprobe for duration/resolution/codec), `convert_proxy_to_4ch` (FFmpeg audio conversion). FFmpeg/FFprobe are embedded sidecar binaries in `src-tauri/binaries/`.

### Frontend↔Backend Communication

- Frontend calls Rust via `invoke('command_name', args)` from `@tauri-apps/api`
- Backend emits `file-change` events back to React for real-time directory updates (listened in `AppContext`)
- Persistent state (selected directories, duration cache) is stored via `tauri-plugin-store`

### Core Data Flow

1. User picks a raw directory → `AppContext` calls `read_directory_files` → `filesList` state updates → `VideoList` renders
2. `watch_directory` starts → file changes emit `file-change` → `AppContext` re-reads directory
3. User selects a file → `curCrmFile` state updates → `VideoInfo` calls `get_video_info` → displays metadata
4. User deletes/stars a file → `useMoveVideo` calls `move_file` → undo history recorded in `oprationHistory`

### Proxy File Mapping

Raw and proxy files are matched by filename (different directories). `getProxyVideoPath.ts` handles the path translation. Deleting/starring a raw file also moves its proxy counterpart.
