# Changelog

All notable changes to this project will be documented in this file.

## [0.2.3] - 2026-05-14

### Added

- Added explicit `@read(...)` requirement-ingestion support for refinement and plan phases.
- Added structured `readTargets`, `textReadTargets`, and `imageReadTargets` handling to workflow-open request parsing.
- Added text read-target ingestion so `@read(path-to-text-doc)` injects actual document content into refinement/plan input.
- Added image read-target execution via `ImageSummaryService` abstraction.
- Added `VisionModelImageSummaryService` for OpenAI-compatible vision APIs.
- Added bounded image read processing:
  - maximum 5 explicit image read targets
  - concurrency limit of 2
  - 5 minute timeout per image
  - summary condensation when prompt budget would be exceeded

### Changed

- Refinement and plan prompts now treat `@read(...)` references as explicit source material.
- Image `@read(...)` targets now attempt summary generation when an external vision service is configured.

### Fallback behavior

- If no image-capable service is configured, image `@read(...)` produces explicit `READ_TARGET_IMAGE_ERROR` output instead of blocking the workflow.
- Image-read failures do not stop refinement/plan progression and do not invent missing image content.

### Verification

- Typecheck passes.
- Build passes.
- `@read(...)` parsing, updater diagnostics, workflow recovery, and observability regression tests pass.

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
