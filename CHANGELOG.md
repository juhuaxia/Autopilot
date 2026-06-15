# Changelog

All notable changes to this project will be documented in this file.

## [0.3.6] - 2026-06-15

### Changed

- Reduced workflow prompt/storage token usage by summarizing stored prompts, status sections, and workflow-open artifact seed inputs while keeping first-dispatch context complete.
- Compressed chained/node-run artifact injection and summarized long skill/status content to keep prompt payloads focused without changing workflow phase ordering.
- Reviewer sidecar/session synchronization now avoids redundant summary rewrites and keeps lightweight reviewer prompt metadata for recovery/status views.

### Fixed

- Fixed clarification -> create-new-workflow flows so structured workflow-open context (`artifactSeedRequest`, full initial request, direct-develop start hints) is preserved instead of degrading to raw payload only.
- Fixed HTTP/OpenCode event streaming so event-pump failures surface as explicit `session.error` signals instead of silently stalling workflow progression.
- Fixed prompt/reviewer persistence metadata so legacy recovery paths continue working when new hash/length fields are absent.

### Verification

- `bun test tests/opencode-session-client.test.ts tests/workflow-command-runner.test.ts tests/workflow-open-request.test.ts tests/prompt-storage-summary.test.ts tests/workflow-engine.test.ts tests/workflow-state-recovery.test.ts`

## [0.3.5] - 2026-06-02

### Added

- Added `ap-goal`, a new public preset/slash command for goal-closing workflows that keep only refinement and plan as human checkpoints.

### Changed

- `ap-goal` now auto-loops `develop -> review -> test` by routing failed `review` and `test` results back to `develop` automatically instead of stopping for normal manual review/test decisions.
- `ap-goal` workflows now use a `30`-iteration repair budget, and existing persisted `ap-goal` workflows are normalized up to that budget when loaded.
- Blocked-state rendering and runtime doctor messaging now distinguish normal review/test manual decisions from `ap-goal` automatic repair budget exhaustion.

### Fixed

- Fixed review sidecar synchronization so stock template guidance still allows automatic conclusion hydration, while manual notes remain protected from overwrite.

### Verification

- `bun test tests/workflow-engine.test.ts tests/workflow-command-runner.test.ts tests/workflow-runtime-doctor.test.ts tests/workflow-lifecycle-e2e.test.ts tests/workflow-open-request.test.ts tests/workflow-plugin-entry.test.ts tests/autopilot-command-presets.test.ts tests/human-action-renderer.test.ts`

## [0.3.4] - 2026-05-27

### Added

- Added `ap-doctor` as a minimal runtime diagnosis command in both CLI and OpenCode host command form.
- Added `ap_doctor` plugin tool support for abnormal workflow state checks.
- Added `workflow_status` guidance to point users at `ap_doctor` when a workflow looks abnormal.

### Changed

- `ap-doctor` now reports only `原因` and `建议` for the three minimal abnormal states: blocked, artifact repair required, and stuck/no progress.
- `workflow_status` and `workflow_back` now degrade gracefully when workflow event logs are malformed.

### Fixed

- Fixed false-positive diagnosis paths so `ap-doctor` remains read-only and does not mutate workflow artifacts or config files.
- Fixed plugin/CLI `ap-doctor` paths so malformed event/artifact state files no longer crash the diagnosis flow.
- Fixed a test isolation issue in the workflow-engine suite by serializing the shared-state describe block.

### Verification

- `bun run typecheck`
- `bun run build`
- `bun test`

## [0.3.3] - 2026-05-21

### Added

- Added explicit approval guidance in human-action rendering so approval blocks now state that explicit user confirmation is required before `workflow_approve` should be used.
- Added standalone prompt-artifact compression tests covering structured compression, placeholder filtering, fallback truncation, and malformed heading edge cases.

### Changed

- Prompt artifact injection for `SOURCE_*_ARTIFACT` and `CURRENT_ARTIFACT` now uses structure-aware section compression before falling back to truncation, reducing prompt size while preserving key phase meaning.
- Approval recommendations now render as user-decision guidance (`confirm approval`) instead of directly recommending `workflow_approve` as the next automatic tool action.
- Primary workflow-agent guidance now explicitly requires showing the full approval block and waiting for explicit user confirmation before calling `workflow_approve`.

### Fixed

- Fixed ambiguous lifecycle confirmation flows so router-level `confirm` decisions persist clarification state and can be continued reliably via `workflow_answer`.
- Fixed `workflow_answer` lifecycle parsing so clarification payloads using `choice` / `intentChoice` are accepted in addition to older fields.
- Fixed new independent workflow creation after clarification so derived workflow IDs are generated correctly even when the base workflow ID already contains hyphens.
- Fixed prompt compression edge cases for missing headings, out-of-order headings, empty sections, placeholder-only sections, and unknown trailing headings leaking into preserved sections.

### Verification

- `bun test tests/prompt-artifact-compression.test.ts tests/human-action-renderer.test.ts tests/workflow-command-runner.test.ts tests/workflow-engine.test.ts`
- `bun run typecheck`

## [0.3.2] - 2026-05-20

### Changed

- `workflow_resume` now accepts plain `fix` / `accept` payloads in addition to the older JSON form.
- Blocked workflow status output and workflow-agent guidance now recommend the simpler `fix` payload when the intended action is to return from blocked review/test to develop.

### Fixed

- Fixed terminal blocked review/test workflows so `workflow_resume` can still record a manual fix decision and route back to `develop` even when no current human-action record is present.
- Fixed blocked-state guidance that previously over-steered review/test recovery toward `workflow_resync` when the user had already confirmed a repair plan.

### Verification

- `bun test tests/human-action-renderer.test.ts tests/workflow-plugin-tool.test.ts tests/workflow-command-runner.test.ts tests/workflow-engine.test.ts`

## [0.3.1] - 2026-05-20

### Added

- Added routing-ignore runtime state so an older active workflow can be preserved without being auto-selected for later preset routing.
- Added stronger develop/review/test validation prompt policies that explicitly require relevant checks, skipped-check reporting, and evidence-based pass/fail decisions.

### Changed

- Active-workflow lifecycle confirmation now makes the "start new" behavior explicit: the old workflow is preserved but no longer auto-routed for future preset requests.
- Resuming an ignored workflow now clears its routing-ignore marker so it can become the active workflow again.

### Fixed

- Fixed preset workflow-open routing so intentionally ignored older workflows do not reappear in later active-workflow confirmations.
- Fixed lifecycle resume/new flows so ignored-routing state is restored correctly across follow-up decisions.

### Verification

- `bun test tests/workflow-engine.test.ts tests/workflow-lifecycle-e2e.test.ts tests/workflow-command-runner.test.ts`

## [0.2.8] - 2026-05-14

### Changed

- `autopilot_update` package mode now performs a real update action by clearing the OpenCode package cache instead of only suggesting a manual npm update.
- Package-mode updater results now report `currentVersion` as unknown after cache invalidation until OpenCode reloads the refreshed package.

### Added

- Added a prominent restart warning block to updater output.
- Added explicit guidance that other OpenCode windows currently using Autopilot should also be restarted.

### Verification

- Updater regression tests pass.
- Typecheck passes.

## [0.2.6] - 2026-05-14

### Changed

- `workflow_install` now registers the npm package entry consistently across CLI and plugin tool flows instead of defaulting to workspace-local `file://dist/plugin.js` paths.
- `autopilot_update` package-mode detection now reads the actual OpenCode package cache version before falling back to local repo `node_modules`.
- Updater diagnostics now distinguish detected Autopilot entries from unrelated plugins and surface stale ignored Autopilot entries more clearly.

### Fixed

- Fixed repeated OpenCode config pollution from stale `workflow-plugin-install-*` temp plugin entries.
- Fixed installer cleanup so dead temporary Autopilot file entries are removed even after the temp directories are gone.
- Fixed plugin tool install/update tests so they no longer mutate the maintainer's real `HOME` config.

### Verification

- Full test suite passes.
- Typecheck passes.

## [0.2.5] - 2026-05-14

### Added

- Added autopilot private inline directives for chat-style workflow control:
  - `/ap-doc:`
  - `/ap-start-at:`
- Added direct-develop workflow initialization that preserves request-aligned phase context.
- Added `workflow_resync` recovery flow for review/test workflows paused after out-of-band edits.

### Changed

- Direct-develop workflows now build synthetic phase baselines from the current request instead of using unrelated default MVP templates.
- `/ap-doc:` is now treated as explicit workflow intent and no longer triggers an extra clarification round.
- Recovery now reruns the current phase from a fresh baseline instead of continuing stale conclusions.

### Fixed

- Fixed direct-develop review/test context leakage from the default template artifacts.
- Fixed `/ap-doc:`-only inputs being misclassified as ambiguous document mentions.

### Verification

- Typecheck passes.
- Workflow directive parsing, direct-develop, and resync regression tests pass.

## [0.2.4] - 2026-05-14

### Added

- Added structured blocked decision semantics for `workflow_resume`.
- Added support for blocked decision payloads such as `{"decision":"fix"}` and `{"decision":"accept"}`.
- Added `allowedDecisions` metadata to blocked human actions so renderer and tool layers can surface actionable next-step payloads.

### Changed

- Review/test blocked states can now distinguish "fix" vs "accept current state" instead of routing both cases through the same payload-less resume path.
- `workflow_resume` payload handling is now propagated through CLI, plugin tool wiring, runtime state, and transition logic.
- Human-action rendering now surfaces a recommended payload for blocked review/test decisions.

### Fixed

- Fixed the real workflow issue where review/test non-blocker FAIL decisions could loop back to the same manual decision point because `workflow_resume` carried no structured choice.
- Fixed blocked-decision state cleanup so consumed manual decisions no longer linger in runtime state after phase advancement.

### Verification

- Typecheck passes.
- Build passes.
- Workflow blocked-decision regression tests pass.

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
