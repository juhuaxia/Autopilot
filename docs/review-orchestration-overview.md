# Review Orchestration Overview

This document summarizes the current review orchestration and consolidation pipeline in Autopilot.

## Scope

The current implementation covers:

- preset-driven reviewer configuration
- reviewer session spawning
- reviewer sidecar aggregation
- review artifact synchronization
- consolidation readiness signaling
- candidate main status / conclusion autofill with safety guards

It does not yet replace the entire review phase state machine with a fully structured reviewer-first pipeline.

## Public Entry Points

Review orchestration is primarily activated through these full-workflow presets:

- `/ap-safe`
- `/ap-debug`
- `/ap-review-heavy`

Each preset expands to `/ap-mode: ...` and then flows through normal `workflow_open` parsing.

Note: public `/ap-verify` is now a verification node command. It expands to `/ap-node-run: verify`, starts at `test`, and does not run the review orchestration phase. The underlying `verify` preset still exists for internal/full-workflow preset behavior.

## Core Layers

### 1. Preset Layer

Defined in `packages/runtime/src/commands/autopilot-presets.ts`.

Each preset can declare:

- reviewer roles
- priority / weight
- mustReport items
- summaryRules
- mergePolicy

### 2. Review Prompt Layer

During review dispatch, Autopilot injects:

- `[REVIEW_ORCHESTRATION]`
- `[REVIEW_SUMMARY_RULES]`
- `[REVIEW_MERGE_POLICY]`

This gives the primary review session a multi-reviewer simulation contract even before reviewer sidecar data exists.

### 3. Reviewer Session Layer

When review starts, Autopilot spawns reviewer sessions for configured reviewer roles.

Reviewer sessions are marked with:

- `kind: "reviewer"`
- `roleName`

Relevant-session selection always prefers non-reviewer sessions so the main workflow session remains authoritative.

### 4. Sidecar Layer

The workflow directory contains `review-sidecar.json`.

It tracks:

- reviewer session IDs
- role names
- prompt payloads
- status
- last summary
- structured severity / confidence / source hints
- merge mode
- completion state
- `readyToConsolidate`

### 5. Artifact Synchronization Layer

`ReviewSidecarManager.syncReviewArtifact()` rewrites a bounded sidecar block in `review.md`.

The block currently includes:

- `## Reviewer Summaries`
- `## Reviewer Findings Summary`
- `## Reviewer Issues`
- `## Candidate Findings For Main Review`
- `## Reviewer Severity Summary`
- `## Reviewer Conclusion Hint`
- `## Reviewer Consolidation Recommendation`
- `## Consolidation Recommendation For Main Conclusion`
- `## Review Merge Context`

The block is wrapped with:

- `<!-- AUTOPILOT_REVIEW_SIDE_CAR_START -->`
- `<!-- AUTOPILOT_REVIEW_SIDE_CAR_END -->`

This allows deterministic overwrite instead of endless append behavior.

### 6. Main Review Autofill Layer

When the sidecar is ready and the main review artifact still contains placeholder values:

- `## 状态` can be autofilled to `PASS` or `FAIL`
- `## 结论` can be autofilled to `PASS` or `FAIL`

Safety rule:

- explicit human or workflow-authored `PASS/FAIL` is never overwritten

## Consolidation Lifecycle

1. Review phase dispatches the primary review session.
2. Reviewer sessions are spawned.
3. Reviewer session status and summaries are synced into the sidecar.
4. When all reviewer sessions are settled, the sidecar is marked:
   - `completedAt`
   - `readyToConsolidate: true`
5. Runtime sets `reviewReadyToConsolidate: true`.
6. Review phase can emit a one-shot consolidation dispatch guarded by:
   - `reviewReadyToConsolidate`
   - `!reviewConsolidationDispatched`
7. Consolidation output assists the main review artifact.

## Current Safety Guarantees

- reviewer sessions do not replace the main workflow session
- reviewer `missing` sessions are treated as failed for settling purposes
- sidecar and review artifact writes are skipped when content is unchanged
- placeholder-only autofill never overwrites explicit final values
- consolidation dispatch is one-shot guarded

## Known Limitations

- structured issue extraction is heuristic, not model-native structured output
- autofill still depends on expected markdown section layout
- reviewer summaries come from the latest available assistant text; fidelity depends on the session client
- final review state is still hybrid: structured sidecar + traditional artifact parsing

## Recommended Next Directions

1. Replace regex-based status/conclusion autofill with section-aware rewriting.
2. Improve reviewer summary extraction quality.
3. Add full-worktree regression coverage for reviewer orchestration scenarios.
4. Consider true parallel reviewer completion handling in the state machine if needed.
