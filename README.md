# Autopilot

**Turn a natural-language request into a structured, reviewable delivery workflow — automatically.**

[中文说明](./GUIDE.zh-CN.md)

---

## What is Autopilot?

Autopilot is a plugin for [OpenCode](https://github.com/opencode-ai/opencode) that acts as an **AI project manager** for your coding requests.

Instead of throwing a requirement at AI and hoping for the best, Autopilot breaks every request into **5 controlled stages**:

```
Your request → Refine → Plan → Build → Review → Test → Done
                 ↑ ask    ↑ approve   ↑ auto    ↑ check   ↑ verify
```

Each stage produces a document you can read, approve, or correct before moving forward. You stay in control; AI does the heavy lifting.

## Why use Autopilot?

| Without Autopilot | With Autopilot |
|---|---|
| One-shot generation, unpredictable output | Staged pipeline, visible at every step |
| AI guesses your intent and starts coding | Ambiguity is resolved **before** code is written |
| Large code dumps are hard to review | Each stage has its own artifact you can inspect |
| Regression risks are left to memory | Impact scope and risk signals are tracked explicitly |
| Every session follows different patterns | Skills inject consistent team conventions |

**Who is this for?**
- Developers who want AI-assisted coding with quality guardrails
- Teams that need consistent patterns across AI-generated code
- Anyone who's experienced "AI wrote 500 lines and half of them are wrong"

## Quick Start (3 steps)

### 1. Install the plugin

Add this to your OpenCode configuration (`opencode.json`):

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

Restart OpenCode. You should see:

```
[autopilot] Autopilot plugin loaded (... commands)
```

### 2. Start your first workflow

Just type your request in natural language. For example:

> Add sorting to the product list page and make sure regression risks are reviewed.

Autopilot will take over from there, guiding you through each stage.

### 3. Follow along

Autopilot will prompt you at key moments:

- **Refinement stage**: It may ask clarifying questions about your request. Answer them to move forward.
- **Plan stage**: It shows you the implementation plan. Approve it when ready.
- **Build / Review / Test**: These run mostly automatically. You'll see results at each stage.

You typically only need **3–5 interactions** per request — mostly answering questions or clicking approve.

## How the workflow works

| Stage | What happens | What you do |
|---|---|---|
| **Refine** | Analyzes your request, fills in gaps, asks questions if something is unclear | Answer clarification questions (or let it infer) |
| **Plan** | Creates a step-by-step implementation plan with file list, risks, and acceptance criteria | Review and approve the plan |
| **Build** | Writes code according to the approved plan | Monitor progress (automatic) |
| **Review** | Checks code quality, consistency, and regression risks | Review findings, decide if fixes needed |
| **Test** | Runs verification and reports pass/fail with evidence | Check test results |

If Review finds issues, the workflow loops back to Build automatically (up to 3 times). If Test fails, it pauses for your decision.

## Configuration

Autopilot creates/uses two configuration files:

| Scope | Path | Purpose |
|---|---|---|
| Global (all projects) | `~/.config/opencode/autopilot.json` | Your personal defaults |
| Project-specific | `<your-project>/.workflow-harness/autopilot.json` | Per-project overrides |

When both exist, they **merge** — project settings are added on top of global ones. If neither file exists, Autopilot creates `autopilot.json` with sensible defaults on first run. **You don't need to configure anything to get started.**

### The autopilot.json file

Here's what a complete configuration looks like, with explanations inline:

```jsonc
{
  // ---- Skill directories ----
  // These folders are scanned for skill files (.md files or directories containing SKILL.md).
  // Use "~" for your home directory. Non-existent paths are silently skipped.
  "skillRoots": [
    "~/.claude/skills",
    "~/.config/opencode/skills"
  ],

  // ---- Stage settings ----
  // Each stage can have:
  //   requiredSkills: which skills to load during this stage
  //   understandingDepth: how deeply AI should analyze your codebase (lightweight / standard / deep)
  "phases": {
    "refinement": {
      "requiredSkills": [],
      "understandingDepth": "lightweight"
    },
    "plan": {
      "requiredSkills": [],
      "understandingDepth": "standard"
    },
    "develop": {
      "requiredSkills": [],
      "understandingDepth": "deep"
    },
    "review": {
      "requiredSkills": [],
      "understandingDepth": "deep"
    },
    "test": {
      "requiredSkills": [],
      "understandingDepth": "standard"
    }
  },

  // ---- Risk signals ----
  // When these patterns are detected in your request, understanding depth is
  // automatically upgraded. Signals with "triggersDeep: true" force deep mode.
  "riskSignals": [
    { "id": "cross_module", "description": "Change spans multiple modules or packages", "triggersDeep": true },
    { "id": "public_component", "description": "Change affects shared components used by other features", "triggersDeep": true },
    { "id": "state_route_permission", "description": "Change touches state management, routing, or permissions" },
    { "id": "dependency_chain", "description": "Requires tracing parent components or import chains" },
    { "id": "history_complexity", "description": "Area has history of complexity, bugs, or regressions", "triggersDeep": true }
  ]
}
```

### Understanding depth — what do the levels mean?

| Depth | Behavior | When it's used by default |
|---|---|---|
| **lightweight** | Extracts core intent only. No deep dependency tracing unless ambiguity is detected. Keeps analysis fast and focused. | Refinement stage — you're still defining *what* to build |
| **standard** | Traces direct dependencies, parent components, and immediate impact scope. Good balance of thoroughness and speed. | Plan & Test stages — enough context to plan and verify |
| **deep** | Comprehensive tracing: parent components, routes, stores, services, shared modules, API contracts, state flow, cross-module impacts. Full picture before touching code. | Build & Review stages — maximum safety when writing/changing code |

> The depth can be **auto-upgraded**: if your request triggers a risk signal (e.g., "cross_module"), even a lightweight stage gets bumped up. This means simple requests stay fast, complex requests get thorough treatment — automatically.

### What are Skills?

A **Skill** is a Markdown file that contains guidelines, rules, or reference material you want AI to follow during a specific workflow stage.

Think of it as a **memo for AI** — like "always use our Button component," "follow these naming conventions," or "run Playwright tests for UI changes."

#### Where to put skill files

Skills live in directories listed under `skillRoots`. Two formats are supported:

| Format | Example | Use when |
|---|---|---|
| Single file | `~/.config/opencode/skills/my-rule.md` | Short guidelines, one file is enough |
| Folder + SKILL.md | `~/.config/opencode/skills/playwright/SKILL.md` | Longer skills with accompanying reference files |

The **filename** (without `.md`) becomes the skill name. For the folder format, the **folder name** is used.

#### Creating your first skill

Let's say you want AI to follow your team's frontend conventions during the build stage:

**Step 1:** Create the skill directory (if it doesn't exist):

```bash
mkdir -p ~/.config/opencode/skills
```

**Step 2:** Create a skill file:

```markdown
# Frontend Design Rules

## Component usage
- Always use existing components from src/components/ before creating new ones.
- Import Button from "@/components/Button/Button.tsx".
- Import Table from "@/components/Table/Table.tsx".

## Styling
- Use Tailwind CSS utility classes. Do not create new CSS files.
- Follow the existing design tokens in src/styles/tokens.ts.

## Accessibility
- All interactive elements must have aria-label.
- Support keyboard navigation for all custom components.
```

Save this as `~/.config/opencode/skills/frontend-design.md`.

**Step 3:** Enable it in your config:

```json
{
  "phases": {
    "develop": {
      "requiredSkills": ["frontend-design"]
    }
  }
}
```

From now on, every time the workflow reaches the **Build** stage, AI receives your design rules as context and follows them while writing code.

#### Practical skill examples

| Skill name | Best for stage | What it does |
|---|---|---|
| `frontend-design` | develop | Inject component library and styling conventions |
| `code-review-checklist` | review | Ensures consistent review criteria across sessions |
| `playwright` | test | Guides AI to write browser-based E2E tests |
| `clarity-guide` | refinement | Encourages AI to resolve ambiguity early |
| `i18n-rules` | develop | Enforces internationalization patterns |

#### What if a skill is missing?

If you reference a skill name in `requiredSkills` but the file doesn't exist in any `skillRoots`, Autopilot notes it as `[MISSING_SKILLS]` in the workflow prompt but **continues running normally**. It won't break your workflow.

## Updating Autopilot

There are two supported update entrypoints:

### Option 1: CLI update

Use this when you want to refresh the installed plugin outside the OpenCode chat flow:

```bash
bun run src/cli.ts update
```

Alias also supported:

```bash
bun run src/cli.ts autopilot-update
```

### Option 2: OpenCode tool update

Inside OpenCode, use the standalone maintenance tool `autopilot_update`.

- It is **not** a `workflow_*` command.
- It is **not** part of `workflow_channel`.
- It does **not** enter any workflow lifecycle or workflow state machine.

If you are chatting with an agent, asking it to **call `autopilot_update`** is more reliable than only sending the literal text `autopilot_update`.

### What the updater does

- **Local source install (`file://<repo>/dist/plugin.js`)**: checks the repo version and only rebuilds when it is behind the latest release.
- **Release file install (`file://~/.config/opencode/plugins/autopilot/plugin.js`)**: downloads the latest GitHub release bundle and replaces the installed plugin safely.
- **npm package install (`@fkqfkq123/opencode-autopilot`)**: reports the installed package version and tells you to run `npm update @fkqfkq123/opencode-autopilot` when needed.

### After updating

- After any real update, restart OpenCode so its in-memory plugin cache reloads the new plugin code.
- If the updater reports that you are already current, no restart is required.

## Troubleshooting

### OpenCode won't start after adding the plugin

Temporarily remove the plugin line from `opencode.json`, restart OpenCode, then re-add it after checking for typos.

### Workflow seems stuck or broken

Delete the runtime folder and start fresh:

```bash
rm -rf .workflow-harness
```

Then re-run your request.

### Plugin loads but commands aren't available

Make sure your OpenCode version supports plugin commands. Try updating both OpenCode and the plugin:

```bash
npm update @fkqfkq123/opencode-autopilot
```

## Fallback install

If you prefer installing from source instead of npm:

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```
