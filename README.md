# StudyFlow

StudyFlow is a lightweight desktop study scheduler for Windows. It focuses on weekly planning, one-off date overrides, local notifications, and daily study-time tracking without requiring an account or cloud sync.

## Highlights

- Minimal desktop UI designed for fast scheduling
- Weekly templates for Monday to Sunday
- Date-specific overrides that do not modify the original template
- Optional notification rules: before start, at start, after end, or combined reminders
- Planned and actual study-time tracking
- Tray mode, close-to-tray behavior, and optional launch at startup
- Local JSON backup and restore
- CSV export for statistics

## Tech Stack

- Tauri 2
- React 19
- TypeScript
- SQLite via `rusqlite`

## Project Structure

```text
src/              React frontend
src/lib/          Schedule and state logic
src-tauri/        Rust backend, tray, persistence, packaging
public/           Static assets
```

## Getting Started

### Requirements

- Node.js 20+
- Rust toolchain
- Windows 10/11

### Development

```bash
npm install
npm run tauri dev
```

### Production Build

```bash
npm run build
npx tauri build --no-bundle
```

The unpacked executable is generated at:

```text
src-tauri/target/release/app.exe
```

## Building an MSI Installer

StudyFlow uses Tauri's Windows bundling pipeline. On a machine with WiX installed and available in `PATH`, run:

```bash
npx tauri build
```

The MSI installer will be generated under:

```text
src-tauri/target/release/bundle/msi/
```

## Core Features

### Today

- View today's schedule on a compact timeline
- Start, complete, skip, or delay a study event
- See remaining time, completed count, and next event

### Weekly Templates

- Create reusable weekly study blocks
- Copy one weekday's arrangement to other weekdays
- Detect time conflicts

### Date Overrides

- Add or edit one-off events for a specific date
- Remove inherited template items only for that date

### Statistics

- Track planned and actual study minutes
- Export CSV reports for a selected date range

### Settings

- Reminder policy configuration
- Tray and startup preferences
- JSON backup and restore

## Open Source

This project is released under the MIT License. See [LICENSE](./LICENSE).

## Notes

- StudyFlow is designed for local, offline-first use.
- Current packaging target is Windows-first.
- Some interface text is still being polished and may continue to improve over time.
