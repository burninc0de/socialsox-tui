# SocialSox TUI

A fast, compose-first terminal app for crossposting to Mastodon, X, and Bluesky with image/video support.

## Features

- Crosspost to Mastodon, X, Bluesky in one action
- Attach up to 4 image/video files
- Concurrent posting with per-platform results
- Credentials stored in system keychain (`keytar`) with file fallback

## Run

```bash
npm install
npm start
```

## Controls

- Up/Down: move field
- Enter: edit selected field
- Space: toggle platform enabled on selected toggle
- `i`: import credentials from legacy SocialSox desktop export
- `s`: save config/credentials
- `p`: post to enabled platforms
- `q`: quit
- `Esc`: stop editing or quit

## Media Notes

- Provide attachment paths as a comma-separated list.
- Max 4 files.
- Images are auto-compressed for X when needed.
- Bluesky video support depends on current ATProto backend support.

## Reset config

```bash
npm start -- --reset-config
```

## Import from desktop SocialSox

The TUI can ingest the `socialsox-credentials.json` export format from the original desktop app.

- Press `i` in the TUI to auto-import.
- It only loads from: `~/.config/socialsox-tui/socialsox-credentials.json`
