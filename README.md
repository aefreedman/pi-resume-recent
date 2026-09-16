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

The cutoff is computed once when the picker opens. Sessions exactly on the boundary are included. Reopen the picker to advance the window. Activity follows Pi 0.85.1's `SessionInfo.modified` semantics: latest user or assistant message timestamp, falling back to creation time and then filesystem modification time. Renaming or copying a session does not itself make its messages recent.

### Avoiding old log reads

The loader lists filenames and checks filesystem modification times first. Files last written before the cutoff are skipped without opening or parsing their contents. A two-second margin accommodates filesystem timestamp rounding. Only shortlisted logs are read to build the native search text and check actual message activity. An old session used recently is included because appending messages updates its file modification time; creation dates and filenames are not used to exclude it.

This shortcut assumes ordinary filesystem timestamps: a log's last write must not predate the messages written to it. Manually backdated files, unusual clock changes, or restored files with inconsistent timestamps can violate that assumption. Use `/resume-recent all` or the built-in `/resume` to bypass the shortcut. Newly copied or renamed old logs may still be read, but their actual activity keeps them out of the filtered results.

Directory enumeration and file metadata checks still cover the selected scope. Recently modified large logs still need full reads to preserve native full-text search. Up to eight files are processed concurrently, and closing the picker cancels pending scanning and active reads. No history index or message cache is written.

The UI intentionally adds no age badge or new controls. Use `/resume-recent-settings` to see the saved window.

The native delete action tries the `trash` command and falls back to permanent deletion when trash is unavailable or fails, just like `/resume`. It requires confirmation and protects the active session. Opening the picker requires an idle interactive terminal session.

## Development

```sh
npm ci --ignore-scripts
npm run validate
npm pack --dry-run
```

Tests cover duration validation, inclusive cutoffs, saved settings, custom/global storage routing, activity versus filesystem timestamps, native render parity, search/scope/selection, and loading through Pi's extension loader. Discovery tests assert that old file contents are never opened, compare metadata with Pi's native reader, exercise cancellation, and report a synthetic archive timing comparison. They use synthetic sessions and temporary directories.

The package uses public Pi exports for the UI and session switching. Its loader recognizes Pi's default session directory encoding and builds the native `SessionInfo` shape for shortlisted files, because Pi's public listing API reads every log before returning. Review directory encoding, metadata parity tests, and the exported picker constructor when upgrading Pi. No picker source is copied and no core files are patched.

`private: true` prevents accidental npm publication during the pilot.

## License

MIT. Pi and its native picker are provided by `@earendil-works/pi-coding-agent` under their own license.
