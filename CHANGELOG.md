# Changelog

## Unreleased

- Align development and deterministic validation with Pi 0.99.1.

### Changed

- Publish activity-filtered partial session lists to Pi's progressive resume picker and honor its per-load cancellation signal.
- Updated Pi development dependency and session metadata validation baseline to 0.86.1.

- Skip old log contents using filesystem modification times before reading shortlisted sessions; retain actual activity filtering and native search metadata.
- Bound file work to eight concurrent reads and cancel scanning when the picker closes.
- Add native metadata parity, no-old-content-read, scope, cancellation, and synthetic performance tests.

- Add `/resume-recent` using Pi's native session picker with a rolling activity cutoff.
- Support arbitrary minute, hour, day, and week durations and an unfiltered override.
- Add `/resume-recent-settings` and a persistent global `maxAge` setting.
- Preserve native picker controls and custom session directory scope.
- Keep the pilot GitHub-only with npm publication disabled.
