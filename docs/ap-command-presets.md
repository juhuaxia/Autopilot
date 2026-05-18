# Autopilot Command Presets

This document records the combined command-entry and workflow-preset design used by Autopilot.

## Goal

Expose discoverable OpenCode slash commands while keeping the full Autopilot workflow runtime in control of phase routing and future preset expansion.

## Public Commands

Autopilot registers these OpenCode-visible commands through plugin config injection:

- `/ap-light`
- `/ap-standard`
- `/ap-safe`
- `/ap-debug`
- `/ap-review-heavy`
- `/ap-develop`
- `/ap-verify`

These commands appear in the OpenCode slash-command autocomplete list, so users can discover available modes without memorizing private directives or reading external docs first.

## Command Behavior

Each public command is a thin entrypoint. It does not implement workflow logic itself.

Instead, it routes execution to the `workflow` agent and expands into a safe Autopilot directive template that the workflow agent then handles through the normal `workflow_open` path.

Current mapping:

- `/ap-light <request>` -> prompt body + `/ap-mode: light` + `/ap-start-at: develop`
- `/ap-standard <request>` -> prompt body + `/ap-mode: standard`
- `/ap-safe <request>` -> prompt body + `/ap-mode: safe`
- `/ap-debug <request>` -> prompt body + `/ap-mode: debug`
- `/ap-review-heavy <request>` -> prompt body + `/ap-mode: review-heavy`
- `/ap-develop <request>` -> prompt body + `/ap-node-run: develop`
- `/ap-verify <request>` -> prompt body + `/ap-node-run: verify`

The command template keeps `$ARGUMENTS` as plain prompt text rather than embedding it inside JSON. This avoids quote/newline escaping failures in OpenCode command expansion.

## Runtime Contract

The workflow-open parser accepts the preset metadata and normalizes it into the workflow request:

- `mode=light|standard|safe`
- optional `startAt=develop`

Autopilot also writes the preset into the generated request body with:

- `[AUTOPILOT_PRESET]`
- `[AUTOPILOT_PRESET_POLICY]`

This keeps the preset visible to downstream workflow stages while preserving structured parsing after command expansion.

## Node Run Contract

Node commands create a new workflow run linked to an existing completed workflow context.

- `runKind=review-heavy` -> `review -> done`
- `runKind=develop` -> `develop -> done`
- `runKind=verify` -> `test -> done`

Node runs carry these metadata fields:

- `runKind`
- `parentWorkflowId`
- `sourceWorkflowId`

`parentWorkflowId` is the immediate workflow/run that spawned the node run. `sourceWorkflowId` is the original completed workflow whose artifacts are being reused for context.

## Current Runtime Effects

The presets are not just labels.

- `light`
  - starts at `develop`
  - records direct-develop state in runtime
  - keeps the workflow narrow and fast while preserving normal review/test guardrails

- `standard`
  - keeps the default phase order
  - adds explicit balanced-mode review/test guidance to runtime dispatch prompts
  - does not force deeper understanding beyond normal phase defaults

- `safe`
  - keeps the default phase order
  - adds stricter review/test guidance to runtime dispatch prompts
  - forces `review` and `test` effective understanding depth to `deep`

- `debug`
  - keeps the default phase order
  - adds bug-oriented refinement/plan/develop/review/test guidance
  - emphasizes reproduce -> isolate -> fix -> verify flow

- `review-heavy`
  - keeps the default phase order
  - emphasizes extra review scrutiny before test completion
  - biases the workflow toward defect discovery and regression exposure

- `verify`
  - keeps the default phase order
  - biases the workflow toward validation evidence and test confidence
  - keeps review concise and verification-oriented

## Configuration Overrides

Project `autopilot.json` can override preset reviewer roles via `reviewOrchestration`.

Example:

```json
{
  "reviewOrchestration": {
    "verify": {
      "reviewRoles": [
        {
          "name": "Custom Verification Reviewer",
          "focus": "Check only release-signoff evidence and validation confidence.",
          "priority": 1,
          "weight": 100,
          "mustReport": ["release-signoff evidence", "validation confidence"]
        }
      ],
      "summaryRules": ["Keep the final report concise.", "Report only verification-relevant evidence."],
      "mergePolicy": {
        "conflictResolution": "prefer_conservative",
        "unresolvedDisagreement": "flag",
        "summaryPriority": "concise",
        "preserveHigherSeverity": true
      }
    }
  }
}
```

When present, the configured roles replace the preset defaults for that mode.

Invalid `reviewRoles` entries are ignored during config loading. Empty `name` or `focus` values will be dropped.

`workflow_status` and `workflow_attach` output the active review orchestration summary so you can see the effective reviewer set, summary rules, and merge policy.

The generated review artifact template is also preset-aware: reviewer sections are created from the active preset's reviewer roles when a review phase starts.

Review dispatch also writes a `review-sidecar.json` file into the workflow directory so reviewer sessions and their merge context can be inspected after the run.

`mustReport` is optional and lets a reviewer declare the evidence types it must explicitly cover in its pass.

`mergePolicy` controls how the consolidated review artifact should resolve disagreements:

- `prefer_high_priority`
- `prefer_high_weight`
- `prefer_conservative`

`unresolvedDisagreement` controls what to do when reviewers still disagree:

- `block`
- `flag`
- `warn`

`summaryPriority` controls whether the final merged review should be `concise`, `balanced`, or `detailed`.

`preserveHigherSeverity` tells the merged review to keep the highest severity interpretation when reviewers disagree on issue severity.

Sorting rules:

- lower `priority` value comes first
- when priorities are equal, higher `weight` comes first
- when both are equal or absent, role name order is used as the final tiebreaker

## Why Both Layers Exist

OpenCode command layer provides:

- slash-command autocomplete
- discoverable descriptions
- user-friendly mode selection

Autopilot runtime layer provides:

- phase-entry control
- direct-develop support
- future review/verify policy expansion
- stable internal protocol beyond prompt-only string concatenation

## Compatibility

Existing private directives still work:

- `/ap-doc: <path>`
- `/ap-start-at: develop`

The runtime now also supports:

- `/ap-mode: light`
- `/ap-mode: standard`
- `/ap-mode: safe`

The public slash commands should be treated as the preferred user-facing interface. Private directives remain useful for advanced manual composition and backward compatibility.
