# pi-resume-recent

Pi's native resume picker, filtered by most-recent session activity. This GitHub pilot is not published to npm.

## Install

Requires Pi 0.85.1 or newer. Tested against 0.85.1.

```sh
pi install git:github.com/aefreedman/pi-resume-recent
```

Run `/reload` in an existing Pi session after installing. For local development, run `pi -e ./index.ts` from this repository.

## Use

```text
/resume-recent                 Saved window (7 days initially)
/resume-recent 2d              Last 2 days, for this invocation
/resume-recent 17d             Any positive duration
/resume-recent 36h             Last 36 hours
/resume-recent all             All sessions, for this invocation
/resume-recent-settings        Enter and save a new default
/resume-recent-settings 14d    Save 14 days as the default
/resume-recent-settings all    Disable the default cutoff
```

Durations accept `m` (minutes), `h` (hours), `d` (24 hours), and `w` (7 days), including fractions such as `1.5d`. They are rolling windows, not calendar dates. Zero, negative, malformed, and unrepresentable durations are rejected.

The setting is stored in `~/.pi/agent/pi-resume-recent.json` (under `PI_CODING_AGENT_DIR` when configured):

```json
{
  "maxAge": "7d"
}
```

Use `null` to disable filtering. The file is reread whenever the command opens; no reload is needed after changing it. This is an extension setting, separate from Pi's `/settings`. An explicit command duration overrides the saved setting for that invocation. To repair an invalid settings file, run `/resume-recent-settings 7d` with an explicit value.

## Picker behavior

The extension directly reuses Pi's exported `SessionSelectorComponent`. It preserves the native layout, theme, search, threaded/recent/fuzzy sorting, named-only filter, scope switching, path display, rename, and confirmed deletion controls. The built-in `/resume` remains available.

Both Current Folder and All are filtered before the picker receives their session lists, including refreshes after rename or deletion. Custom session directories stay scoped to their configured storage. A recent child of an excluded parent appears as a root. Filtering never deletes or rewrites sessions.

The cutoff is computed once when the picker opens. Sessions exactly on the boundary are included. Reopen the picker to advance the window. Pi's `SessionInfo.modified` supplies the activity timestamp: latest message activity, falling back to creation time and then filesystem modification time. Renaming or copying a session does not itself make its messages recent.

The UI intentionally adds no age badge or new controls. Use `/resume-recent-settings` to see the saved window. The picker still reads session metadata before filtering, so this is a visibility filter, not a promise of faster session scanning.

The native delete action tries the `trash` command and falls back to permanent deletion when trash is unavailable or fails, just like `/resume`. It requires confirmation and protects the active session. Opening the picker requires an idle interactive terminal session.

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm pack --dry-run
```

Tests cover duration validation, inclusive cutoffs, saved settings, custom/global storage routing, activity versus filesystem timestamps, native render parity, search/scope/selection, and loading through Pi's extension loader. They use synthetic sessions and temporary directories.

The package uses public Pi exports, with one small compatibility helper for recognizing Pi's default session directory encoding because the read-only extension context does not expose `usesDefaultSessionDir()`. Review that helper and the exported picker constructor when upgrading Pi. No picker source is copied and no core files are patched.

`private: true` prevents accidental npm publication during the pilot.

## License

MIT. Pi and its native picker are provided by `@earendil-works/pi-coding-agent` under their own license.
