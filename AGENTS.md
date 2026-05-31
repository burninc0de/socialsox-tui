# AGENTS.md

## What this is

TUI crossposter for Mastodon, X, and Bluesky. Single-package Node app using [Ink](https://github.com/vadimdemedes/ink) (React for CLI). No build step — `tsx` runs JSX directly.

## Commands

- `npm run dev` — watch mode, auto-restarts on file changes
- `npm start` — run once (no watch)
- `npm start -- --reset-config` — wipe saved credentials

There is no lint, typecheck, or test suite.

## Architecture

- `src/cli.js` — entry point, parses args with meow, renders the Ink app
- `src/app.jsx` — **entire UI** in one file (~650 lines). All screens, input handling, and rendering live here
- `src/lib/` — backend modules: `config.js` (credentials), `platforms.js` (APIs), `media.js` (image processing), `clipboard.js` (system clipboard), `crosspost.js` (posting orchestrator)

## Key conventions

- ESM throughout (`"type": "module"`). Use `import`, not `require`.
- No TypeScript — all `.js` and `.jsx`. Types are not checked.
- UI styling is inline chalk + Ink `<Box>`/`<Text>` components. No CSS or external styles.
- Config dir: `~/.config/socialsox-tui/`
- Credentials: system keychain via `keytar`, with encrypted file fallback (`~/.config/socialsox-tui/socialsox-credentials.json`)
- Clipboard on Linux requires `wl-paste` (Wayland) or `xclip` (X11)

## Gotchas

- `keytar` requires native compilation (`node-gyp`). If `npm install` fails, ensure build tools are installed.
- The app clears the terminal on startup (`cli.js:26`). This is intentional.
- Image compression for X uses `sharp`. Max 4 media items total (file paths + pasted blobs).
- `app.jsx` is monolithic. When editing, search for the section you need rather than scrolling — the file has comment-like markers in the rendering tree structure.
