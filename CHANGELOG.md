# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-05-13

### Added

- Added standalone `autopilot_update` maintenance tool plus `update` / `autopilot-update` CLI entrypoints.
- Added install-mode-aware update behavior for:
  - local source installs
  - GitHub release file installs
  - npm package installs
- Added workflow recovery protections for stale phase artifacts:
  - stale/template artifact detection
  - one-shot artifact-only repair dispatch
  - lightweight artifact-repair prompts for develop / review / test
  - clearer blocked recovery guidance
- Added artifact repair lifecycle observability:
  - `artifact.repair_dispatched` event
  - `artifact.repair_blocked` event
  - watch output visibility
  - status / attach repair detail visibility
- Added MIT license metadata and root `LICENSE` file.
- Added npm public publish readiness metadata:
  - `author`
  - `homepage`
  - `repository`
  - `bugs`
  - `engines`
  - `sideEffects`
- Added `pack:dry-run` script.

### Changed

- Renamed updater implementation from workflow-oriented naming to autopilot-oriented naming:
  - `workflow_update` → `autopilot_update`
  - `workflow-updater.ts` → `autopilot-updater.ts`
- Kept updater logic fully outside workflow channel command flow.
- Refactored artifact repair prompt generation into a dedicated helper.
- Unified blocked diagnostic construction for develop / review / test artifact failure paths.
- Extended artifact-only repair flow from develop to review and test with phase-specific safety guards.
- Updated release workflow to publish to npm automatically when `NPM_TOKEN` is configured.
- Updated README and Chinese guide with dedicated update/publish guidance.

### Fixed

- Fixed unsafe release-file update replacement behavior by making installed release replacement safer.
- Fixed stale build artifact leakage into published tarballs by cleaning `dist` before build.
- Fixed package-mode updater version reporting to read the installed package version instead of the repo version.
- Fixed updater result semantics by separating previous/current version reporting.
- Fixed unnecessary local-source rebuilds when already up to date.
- Fixed workflow artifact completion edge cases where develop/review/test could stall on stale template artifacts without clear operator guidance.

### Verification

- Typecheck passes.
- Build passes.
- Workflow recovery / prompt / observability regression tests pass.
