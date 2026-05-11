# Autopilot

English | [中文说明](./GUIDE.zh-CN.md)

Autopilot is an OpenCode-oriented **attached-session workflow harness**. It provides a workflow runtime skeleton covering refinement, planning, development, review, and testing, plus a locally loadable plugin, CLI entrypoints, and diagnostics.

## 1. What this project provides

- A full workflow phase chain: `spec_refinement -> plan -> develop -> review -> test -> done`
- OpenCode-facing workflow commands such as `workflow_open`, `workflow_attach`, `workflow_status`, `workflow_answer`, `workflow_approve`, `workflow_resume`, and `workflow_back`
- Plugin loading and native primary workflow agent registration for OpenCode-style hosts
- `install` and `doctor` flows for bootstrapping configuration and validating setup
- Review/test loop-back semantics, human breakpoints, event storage, attach/re-attach support

## 2. Who this is for

Autopilot is a good fit if you want to:

- add a workflow primary agent to an OpenCode-style host,
- structure engineering work into explicit workflow phases,
- validate a workflow runtime and command surface through a plugin.

## 3. Prerequisites

Recommended environment:

- macOS / Linux / Windows
- [Bun](https://bun.sh/) `1.3.5` or a compatible version
- OpenCode installed if you want to actually load and verify the plugin

Check Bun:

```bash
bun --version
```

If Bun is not installed yet:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then restart your terminal and verify again:

```bash
bun --version
```

## 4. Installation

### 4.1 Recommended: install as an npm plugin package

OpenCode supports npm-based plugins directly. Once this package is published, the simplest configuration is:

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

You can also pin a version:

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot@0.1.0"]
}
```

In this mode, OpenCode installs and caches the npm package automatically. No manual `git clone`, local `plugin.js`, or extra install script is required.

### 4.2 Fallback: install from GitHub Releases

If you prefer a local-file installation path or need a fallback distribution mode, use the one-line installer from GitHub Releases:

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```

Install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash -s -- --version v0.1.0
```

The fallback installer will:

- download the prebuilt release package from GitHub Releases,
- install it into `~/.config/opencode/plugins/autopilot/`,
- update `~/.config/opencode/opencode.json`.

Release requirement:

- Each GitHub Release must include `autopilot-release.tar.gz`
- The repository includes `.github/workflows/release.yml`, which builds and uploads that file automatically on `v*` tags

If you want to modify the codebase or work from source, continue with the source setup below.

### 4.3 Clone the repository

```bash
git clone https://github.com/juhuaxia/Autopilot.git
cd Autopilot
```

### 4.4 Install dependencies

```bash
bun install
```

The project uses `bun.lock`, so dependencies are expected to stay reproducible.

## 5. Recommended first-run commands

Run these from the project root:

```bash
bun run src/cli.ts install
bun run src/cli.ts doctor
bun run build
```

What they do:

1. `install`
   - creates project-level `.workflow-harness/workflow.json`
   - tries to safely update `~/.config/opencode/opencode.json`
   - normalizes `opencode.jsonc` into `opencode.json` when safe
2. `doctor`
   - checks `workflow.json`
   - checks `skillRoots`
   - checks phase-level `requiredSkills`
   - reports warnings and missing pieces
3. `build`
   - compiles TypeScript
   - produces `dist/plugin.js`

After that, confirm:

- `.workflow-harness/workflow.json` exists
- `doctor` shows no blocking configuration issue
- `dist/plugin.js` exists

## 6. Common development commands

### 6.1 Build

```bash
bun run build
```

### 6.2 Typecheck

```bash
bun run typecheck
```

### 6.3 Run tests

```bash
bun test
```

### 6.4 Run plugin smoke tests

```bash
bun run smoke:plugin
```

### 6.5 Run CLI commands directly

```bash
bun run src/cli.ts doctor
bun run src/cli.ts install
```

Or through the script alias:

```bash
bun run cli --help
```

> The CLI mainly provides workflow initialization, attach/status flows, and install/doctor actions.

## 7. CLI quick usage

### 7.1 Initialize config

```bash
bun run src/cli.ts install
```

### 7.2 Run a self-check

```bash
bun run src/cli.ts doctor
```

### 7.3 Create a workflow

```bash
bun run src/cli.ts workflow-open wf-1
```

### 7.4 Check workflow status

```bash
bun run src/cli.ts workflow-status wf-1
```

### 7.5 Re-attach to the workflow channel

```bash
bun run src/cli.ts workflow-attach wf-1
```

## 8. Loading the plugin into OpenCode

### 8.0 Recommended npm plugin path

Recommended OpenCode config:

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

### 8.1 Fallback release-based path

If you prefer a local installed fallback plugin, use:

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```

Default install location:

```txt
~/.config/opencode/plugins/autopilot/
```

The installer will register a plugin entry similar to:

```txt
file:///Users/<your-user>/.config/opencode/plugins/autopilot/plugin.js
```

### 8.2 Source-development path

Run:

```bash
bun run src/cli.ts install
bun run src/cli.ts doctor
```

If the installer can safely update the OpenCode config, you usually do not need to edit anything manually.

> `install.sh` targets GitHub Releases installs. The project-local installer targets source-development setups.

### 8.3 Manual plugin registration

OpenCode config is usually located at:

- `~/.config/opencode/opencode.json`
- or `~/.config/opencode/opencode.jsonc`

#### Option A: load the built plugin

Build first:

```bash
bun run build
```

Then add this to OpenCode config:

```json
{
  "plugin": [
    "file:///ABSOLUTE_PATH_TO_PROJECT/dist/plugin.js"
  ]
}
```

#### Option B: load source directly during development

```json
{
  "plugin": [
    "file:///ABSOLUTE_PATH_TO_PROJECT/plugin.ts"
  ]
}
```

### 8.4 Start OpenCode

Interactive mode:

```bash
opencode
```

Server mode:

```bash
opencode serve
```

## 9. What you should see after loading

The plugin exposes these tools/commands:

- `workflow_channel`
- `workflow_open`
- `workflow_attach`
- `workflow_status`
- `workflow_answer`
- `workflow_approve`
- `workflow_resume`
- `workflow_back`
- `workflow_doctor`

Recommended split-tool entrypoints:

- `workflow_open`
- `workflow_attach`
- `workflow_status`
- `workflow_answer`
- `workflow_approve`
- `workflow_resume`
- `workflow_back`

Typical load log:

```txt
[autopilot] Autopilot plugin loaded (... commands)
```

## 10. Directory layout

### 10.1 Configuration layers

- user default: `~/.config/opencode/workflow.json`
- project override: `<repo>/.workflow-harness/workflow.json`
- runtime state: `<repo>/.workflow-harness/workflows/<workflowId>/`

### 10.2 What each directory does

- `src/` — CLI entrypoints and top-level source files
- `packages/runtime/` — workflow runtime implementation
- `tests/` — tests
- `scripts/` — auxiliary scripts
- `.workflow-harness/` — runtime config, state, and artifacts
- `dist/` — build output

## 11. Minimal `workflow.json` example

Start with a fully neutral config:

```json
{
  "skillRoots": ["~/.claude/skills", "~/.config/opencode/skills"],
  "phases": {
    "develop": { "requiredSkills": [] },
    "test": { "requiredSkills": [] }
  }
}
```

Then add skills per project. For example, for a frontend-oriented project:

```json
{
  "skillRoots": ["~/.claude/skills", "~/.config/opencode/skills"],
  "phases": {
    "develop": { "requiredSkills": ["frontend-design"] },
    "test": { "requiredSkills": ["playwright"] }
  }
}
```

That frontend example is only an example. The workflow runtime is not frontend-bound by default.

Recommendations:

- keep skill/profile config in global or project-level `workflow.json`
- do not put skill config under `workflows/<workflowId>/`
- run `workflow_doctor` or CLI `doctor` before using a new config

## 12. FAQ

### Q1: What if `install` cannot update my OpenCode config?

Edit OpenCode config manually and add either the release plugin path or the local build path to the `plugin` array. Example:

```json
{
  "plugin": [
    "file:///Users/<your-user>/.config/opencode/plugins/autopilot/plugin.js"
  ]
}
```

For source development, you can also point to your local `dist/plugin.js`.

If you are using the npm plugin mode, you can simply configure:

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

### Q2: Why can’t I see workflow commands after building?

That usually means the host integration layer has not actually registered the exported `workflowCommands` onto the host command/tool surface.

### Q3: What should I validate first?

Validate this order first:

1. the host can import the plugin file
2. the host can call the default export
3. the host receives a plugin-like object

Do not start by validating UI behavior first.

### Q4: Any important rule for the plugin root entry?

The root `plugin.ts` entry should only expose a single host-callable default export. Do not expose extra internal classes or helper functions from the root entry.

## 13. Recommended reading

| Document | Purpose |
|---|---|
| `README.md` | Main entry for installation, release, and usage |
| `WORKFLOW_SKILL_PROFILE_ARCHITECTURE_CN.md` | Skill/profile configuration design |
| `OPENCODE_WORKFLOW_AGENT_GUIDE.md` | Agent/tool calling loop |
| `REQUIREMENT_TEMPLATE.md` | Requirement input template |

Internal planning notes, acceptance drafts, and status scratch docs can be kept locally under `docs_internal/`, which is ignored by default.

## 14. Fastest path to a working setup

If you just want the fastest local source setup:

```bash
bun install
bun run src/cli.ts install
bun run src/cli.ts doctor
bun run build
opencode
```

Then:

1. confirm `.workflow-harness/workflow.json` exists
2. confirm `dist/plugin.js` exists
3. if OpenCode does not auto-load the plugin, add `file:///ABSOLUTE_PATH_TO_PROJECT/dist/plugin.js` manually to config
4. verify `workflow_open`, `workflow_attach`, and `workflow_status` are visible in the host
