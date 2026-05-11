# Autopilot

English | [中文说明](./GUIDE.zh-CN.md)

Autopilot is an OpenCode plugin that turns a natural-language request into a structured workflow: refinement, plan, implementation, review, and testing.

## Install

Add the plugin to your OpenCode config:

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot@0.1.5"]
}
```

Restart `opencode`.

If the plugin loads correctly, you should see a log like:

```txt
[autopilot] Autopilot plugin loaded (... commands)
```

## Use

Start with a natural-language request, for example:

```txt
Add sorting to the product list page and make sure regression risks are reviewed.
```

Autopilot will guide the workflow through the available tools:

- `workflow_open`
- `workflow_attach`
- `workflow_status`
- `workflow_answer`
- `workflow_approve`
- `workflow_resume`

You usually only need to follow the next recommended tool shown by the workflow output.

## Configuration

Autopilot automatically creates these files when needed:

```txt
.workflow-harness/autopilot.json
~/.config/opencode/autopilot.json
```

If they are left empty, Autopilot uses default behavior.

### `autopilot.json`

Minimal example:

```json
{
  "skillRoots": ["~/.claude/skills", "~/.config/opencode/skills"],
  "phases": {
    "spec_refinement": { "requiredSkills": [] },
    "plan": { "requiredSkills": [] },
    "develop": { "requiredSkills": [] },
    "review": { "requiredSkills": [] },
    "test": { "requiredSkills": [] }
  }
}
```

Field meanings:

- `skillRoots`: directories to scan for skill files
- `phases.<phase>.requiredSkills`: skills to inject into that phase

Supported phases:

- `spec_refinement`
- `plan`
- `develop`
- `review`
- `test`

If an old `workflow.json` exists and `autopilot.json` does not, Autopilot can reuse the legacy file and warn you to migrate.

## Fallback Install

If you prefer a local file install instead of the npm package:

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```

## Troubleshooting

### OpenCode fails to start

Temporarily remove the plugin from `opencode.json`, restart OpenCode, then re-enable it after checking the config.

### The plugin loads but workflow commands do not appear

This usually means the host did not register the exported workflow tools correctly.

### A workflow seems broken

Delete the project runtime folder and start again:

```bash
rm -rf .workflow-harness
```

## For source development

If you want to work on the plugin itself:

```bash
bun install
bun run typecheck
bun test
bun run build
```
