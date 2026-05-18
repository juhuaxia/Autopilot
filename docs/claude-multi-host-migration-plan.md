# Claude And Multi-Host Migration Plan

This document defines the recommended migration path for adding Claude support without destabilizing the current OpenCode release line.

## Goal

Refactor Autopilot from an OpenCode-first plugin into a multi-host workflow platform that:

- preserves the current OpenCode behavior
- adds a Claude-specific host integration
- leaves room for future Cursor and VSCode integrations
- keeps workflow core logic host-agnostic

## Non-Goals

This plan does not assume that all hosts will share identical capabilities.

It does not require:

- identical command UX across hosts
- identical session APIs across hosts
- immediate implementation of Cursor or VSCode support
- a one-shot rewrite of the full repository

## Current State Summary

The repository already contains a reusable workflow core, but the host boundary is not fully abstracted.

Reusable layers already exist in these areas:

- `packages/core`
- most of `packages/runtime`
- workflow state, artifacts, events, review orchestration, and human-action flow

OpenCode-specific assumptions still exist in these areas:

- session client naming and semantics
- plugin entry and command registration
- installer and updater behavior
- global config paths under `~/.config/opencode`
- OpenCode-specific prompt and command wording
- package naming and release assumptions

## Target Architecture

The long-term structure should move toward a multi-package host model.

Recommended package direction:

- `packages/core`
- `packages/runtime`
- `packages/host-api`
- `packages/adapters/opencode`
- `packages/adapters/claude`
- `packages/opencode-plugin`
- `packages/claude-plugin`

Future hosts can then add:

- `packages/adapters/cursor`
- `packages/adapters/vscode`
- host-specific release packages when needed

## Core Design Rule

`core` and `runtime` must not directly import host-specific code.

That means the following kinds of logic must move behind interfaces:

- session creation and prompt injection
- session status polling and event streaming
- command registration
- notification and toast behavior
- host todo synchronization
- host config location and installation behavior

## Phase 1 Outcome

The first migration phase should deliver:

- no regression to OpenCode runtime behavior
- a clean host abstraction layer
- a Claude host adapter scaffold
- a Claude-specific release path that does not overwrite OpenCode artifacts

Claude support in phase 1 should target minimum viable workflow execution, not full parity with OpenCode UX.

## Required Refactors

### 1. Introduce a Host API package

Create a new package for host-neutral interfaces.

Recommended initial interfaces:

- `WorkflowSessionClient`
- `WorkflowSessionEvent`
- `WorkflowCommandRegistry`
- `WorkflowHostNotifier`
- `WorkflowHostTodoBridge`
- `WorkflowHostConfigProvider`

The purpose of this package is to give `runtime` a stable dependency that does not mention OpenCode or Claude.

### 2. Rename and relocate session abstractions

Current files:

- `packages/adapters/opencode/src/opencode-session-client.ts`
- `packages/runtime/src/sessions/file-system-session-coordinator.ts`
- `packages/runtime/src/sessions/session-coordinator.ts`

Current issue:

- runtime imports types from the OpenCode adapter package
- the type names still encode the host in the interface itself

Target change:

- move shared session interfaces into `packages/host-api`
- rename `OpencodeSessionClient` to `WorkflowSessionClient`
- rename `SessionEvent` to `WorkflowSessionEvent`
- let OpenCode and Claude each implement the same shared interface from their own adapter package

This is the most important decoupling change.

### 3. Remove OpenCode imports from runtime bootstrap

Current file:

- `packages/runtime/src/bootstrap/create-harness.ts`

Current issue:

- imports `HttpOpencodeSessionClient` and `InMemoryOpencodeSessionClient`
- accepts `opencodeBaseUrl` and `opencodePassword`
- writes global config under `~/.config/opencode`

Target change:

- accept host-neutral options such as:
  - `sessionClient`
  - `hostConfigProvider`
  - `homeDir`
- move OpenCode-specific HTTP session bootstrapping into the OpenCode adapter
- keep the in-memory client as either runtime test infrastructure or move it into a shared test adapter
- stop hardcoding OpenCode config paths inside runtime bootstrap

### 4. Split plugin entry from workflow logic

Current files:

- `packages/runtime/src/plugin/workflow-plugin-entry.ts`
- `packages/runtime/src/commands/create-opencode-workflow-commands.ts`
- `packages/runtime/src/commands/opencode-plugin-command-adapter.ts`

Current issue:

- command registration is host-specific but lives next to runtime logic
- workflow tools are named and composed around OpenCode plugin expectations
- host capabilities like `todo` and `showToast` are accessed directly in the plugin entry

Target change:

- keep workflow command semantics in host-neutral code
- move host registration logic into per-host packages
- extract optional host capabilities behind interfaces
- allow Claude to omit unsupported features without affecting runtime correctness

Recommended split:

- host-neutral command definitions remain in runtime
- `packages/opencode-plugin` registers OpenCode tools and commands
- `packages/claude-plugin` registers Claude tools and commands

### 5. Isolate installer and updater by host

Current files:

- `packages/runtime/src/install/workflow-installer.ts`
- `packages/runtime/src/install/autopilot-updater.ts`

Current issue:

- these are entirely OpenCode-specific operational flows
- they manipulate OpenCode config files and package cache

Target change:

- move OpenCode install and update logic into an OpenCode-specific package
- do not keep host installation logic in shared runtime
- add a separate Claude install path later only when the Claude packaging format is finalized

### 6. Make config resolution host-aware but runtime-neutral

Current file:

- `packages/runtime/src/config/workflow-config.ts`

Current issue:

- default skill roots and config locations still include OpenCode-first assumptions

Target change:

- separate workflow config content from host config discovery
- keep workflow config schema in runtime
- move host-specific filesystem lookup rules into config provider implementations

Recommended behavior:

- runtime consumes resolved config objects
- each host decides where global config is stored
- project-level `.workflow-harness/autopilot.json` can remain shared

### 7. Neutralize OpenCode-specific prompt wording

Current file examples:

- `packages/runtime/src/commands/workflow-open-request.ts`
- `README.md`
- `GUIDE.zh-CN.md`

Current issue:

- some prompt blocks explicitly mention OpenCode slash commands
- product documentation frames Autopilot as an OpenCode-only plugin

Target change:

- rewrite runtime prompt text so it refers to host commands or preset sources generically
- keep OpenCode-specific wording only in OpenCode docs
- add Claude-specific docs later in a separate guide

## Recommended Package Migration Steps

### Step 1. Create shared host interfaces

Add `packages/host-api` and move all shared session and optional host capability types there.

Expected file actions:

- create `packages/host-api/src/session.ts`
- create `packages/host-api/src/commands.ts`
- create `packages/host-api/src/host-capabilities.ts`
- update runtime imports away from `packages/adapters/opencode/...`

### Step 2. Convert the OpenCode adapter to consume host-api

Expected file actions:

- keep `packages/adapters/opencode/src/opencode-session-client.ts`
- make it implement `WorkflowSessionClient`
- move OpenCode-only SDK typing to the adapter package

This step should preserve existing behavior while proving the abstraction boundary.

### Step 3. Move OpenCode plugin code into a dedicated host package

Expected file actions:

- move or copy `packages/runtime/src/plugin/workflow-plugin-entry.ts`
- move OpenCode command creation code out of runtime-facing naming
- create a dedicated OpenCode package entrypoint

Possible destination:

- `packages/opencode-plugin/src/plugin-entry.ts`

### Step 4. Extract installation and update flows

Expected file actions:

- move `workflow-installer.ts` into an OpenCode package
- move `autopilot-updater.ts` into an OpenCode package
- leave runtime free of host package management concerns

### Step 5. Add a Claude adapter scaffold

Expected file actions:

- create `packages/adapters/claude/src/...`
- implement `WorkflowSessionClient` using Claude host capabilities
- document unsupported capabilities explicitly, such as toast or todo sync if unavailable

This step should focus on minimum viable workflow execution only.

### Step 6. Add a Claude release package

Expected file actions:

- create `packages/claude-plugin/`
- define Claude-specific entrypoint, manifest, and packaging rules
- keep release artifact names distinct from OpenCode artifacts

## Suggested File-Level Impact

The following files should be treated as high-priority refactor points.

### High Priority

- `packages/adapters/opencode/src/opencode-session-client.ts`
- `packages/runtime/src/bootstrap/create-harness.ts`
- `packages/runtime/src/sessions/file-system-session-coordinator.ts`
- `packages/runtime/src/sessions/session-coordinator.ts`
- `packages/runtime/src/plugin/workflow-plugin-entry.ts`
- `packages/runtime/src/commands/create-opencode-workflow-commands.ts`
- `packages/runtime/src/commands/opencode-plugin-command-adapter.ts`
- `packages/runtime/src/install/workflow-installer.ts`
- `packages/runtime/src/install/autopilot-updater.ts`
- `packages/runtime/src/config/workflow-config.ts`

### Medium Priority

- `packages/runtime/src/commands/workflow-open-request.ts`
- `src/cli.ts`
- `README.md`
- `GUIDE.zh-CN.md`
- tests that encode OpenCode naming assumptions

### Lower Priority

- package metadata cleanup
- changelog wording
- release automation naming normalization

## Migration Strategy

Use an additive migration rather than a destructive rewrite.

Recommended order:

1. add host-neutral interfaces
2. switch OpenCode code to those interfaces without changing behavior
3. move host-specific code out of runtime
4. add Claude host package and release path
5. clean up docs and naming after behavior is stable

This reduces regression risk because OpenCode remains the first validation target for each abstraction step.

## Branch Strategy

Recommended branch approach:

- keep `main` as the stable OpenCode release line
- create a long-lived migration branch for multi-host work
- merge in vertical slices after each abstraction step is proven

Suggested branch name:

- `multi-host-foundation`

If Claude development needs temporary experimentation, use short-lived child branches off that migration branch.

## Testing Strategy

Testing should be split into three levels.

### 1. Core and runtime regression tests

These verify that host abstraction does not break workflow behavior.

Focus areas:

- workflow phase progression
- human-action behavior
- review orchestration
- session readiness and recovery

### 2. Adapter contract tests

Each host adapter should prove that it satisfies the shared host interfaces.

OpenCode adapter tests should stay green during the migration.

Claude adapter tests should initially cover:

- session creation
- prompt injection
- status mapping
- event mapping or documented fallback behavior

### 3. Host package integration tests

Each host package should validate:

- command registration
- tool exposure
- config resolution
- packaging entrypoint correctness

## Risks

### Risk 1. Runtime still leaks host details

If runtime continues importing host types, the abstraction will look cleaner without actually being cleaner.

Mitigation:

- enforce that runtime only imports from `core`, `host-api`, and runtime-local modules

### Risk 2. Claude host lacks parity features

Claude may not support all OpenCode host features.

Mitigation:

- define optional capabilities explicitly
- do not make workflow correctness depend on toast or todo sync

### Risk 3. Installer logic blocks abstraction progress

Install and update code can keep dragging host assumptions back into shared packages.

Mitigation:

- move operational packaging logic out of runtime early

### Risk 4. Shared package naming stays OpenCode-first

Even after code refactors, package names and docs can continue to bias the architecture.

Mitigation:

- treat naming cleanup as a planned step after the abstraction layer is proven

## Definition Of Done For Phase 1

Phase 1 should be considered complete when all of the following are true:

- runtime no longer imports from `packages/adapters/opencode`
- shared session and host capability types live in a host-neutral package
- OpenCode plugin behavior still passes existing tests
- OpenCode installer and updater are outside shared runtime
- Claude has a dedicated adapter and dedicated release package scaffold
- repository structure clearly supports adding Cursor and VSCode later

## Recommended Immediate Next Actions

1. Create `packages/host-api` and move session-related shared types there.
2. Refactor runtime to depend only on host-neutral interfaces.
3. Move OpenCode plugin entry and install/update logic into dedicated OpenCode packages.
4. After OpenCode regression tests pass, start the Claude adapter scaffold.

This sequencing gives the best balance between long-term architecture quality and short-term release safety.
