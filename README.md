# Autopilot

Turn a natural-language coding request into a staged workflow you can inspect, answer, approve, and recover.

[中文说明](./GUIDE.zh-CN.md)

---

## What Autopilot does

Autopilot runs your request through these stages:

```text
Request -> Spec refinement -> Plan -> Develop -> Review -> Test -> Done
```

At each step, it can:

- ask you clarification questions
- ask you to approve the plan
- pause when review/test needs your decision
- let you continue, resync, or start a new workflow

The goal is simple: less one-shot guessing, more visible control.

## Install

Add the plugin to your OpenCode config:

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

Restart OpenCode.

## Quick start

Just describe what you want:

```text
Add sorting to the product list page and review regression risk.
```

Or start with a requirement doc:

```text
Please start workflow for this request.
/ap-doc: docs/requirement.md
/ap-mode: safe
```

## Copy-paste examples

### 1. Start a normal workflow

```text
Add sorting to the product list page and review regression risk.
```

### 2. Start from a requirement document

```text
Please start workflow for this request.
/ap-doc: docs/requirement.md
/ap-mode: safe
```

### 3. Start direct-develop for a small clear change

```text
Update the button copy on the checkout page.
/ap-start-at: develop
```

### 4. Resume a blocked review/test workflow and go back to develop

```text
workflow_resume
payload: fix
```

### 5. Rerun review/test after manual out-of-band edits

```text
workflow_status -> workflow_resync -> workflow_attach
```

## What you will usually do

### 1. Answer clarification questions

If refinement cannot safely infer something, Autopilot will ask.

Typical example:

- acceptance criteria
- scope boundary
- whether to continue current work or start a new one

### 2. Approve the plan

Plan approval is a **human confirmation point**.

Autopilot should show you the full approval block first. You should explicitly confirm before `workflow_approve` is used.

### 3. Read review/test results

If review or test finds issues, the workflow may:

- loop back to develop automatically
- pause and wait for your decision

## Inline directives you can use in chat

These are **not** OpenCode slash commands. They are inline directives parsed by Autopilot inside normal chat messages.

### `/ap-doc:`

Marks a document as an explicit input source for this workflow.

```text
/ap-doc: docs/requirement.md
```

Use this when you want Autopilot to treat a specific document as the request source instead of guessing.

### `/ap-mode:`

Sets the workflow mode.

```text
/ap-mode: light
/ap-mode: standard
/ap-mode: safe
/ap-mode: debug
/ap-mode: review-heavy
/ap-mode: verify
/ap-mode: ap-goal
```

`ap-goal` keeps `refinement` and `plan` as the only human checkpoints.
After that, if `review` or `test` fails, the workflow automatically returns to `develop` and keeps iterating until pass or until the repair budget is exhausted.
The current `ap-goal` repair budget is `30` iterations.

### `/ap-start-at: develop`

Skips refinement and plan, then starts directly in `develop`.

```text
/ap-start-at: develop
```

Use this only when the task is already clear enough and you intentionally want a direct-develop path.

## Public slash commands

These **do** appear in OpenCode command completion:

- `/ap-light`
- `/ap-standard`
- `/ap-safe`
- `/ap-debug`
- `/ap-review-heavy`
- `/ap-goal`
- `/ap-develop`
- `/ap-verify`

Use them when you want a discoverable command entrypoint.

## Workflow recovery

### When to use `workflow_resume`

Use `workflow_resume` when a workflow is blocked and you want it to continue.

For blocked review/test cases, plain payloads are supported:

- `fix`
- `accept`

Typical meaning:

- `fix`: return to develop and fix the problem
- `accept`: accept the current state and continue/finish if allowed

### When to use `workflow_resync`

Use `workflow_resync` when:

- the workflow is paused in `review` or `test`
- you changed code outside the workflow
- you want the current phase rerun against the latest worktree

Typical sequence:

```text
workflow_status -> workflow_resync -> workflow_attach
```

## Task relationship confirmations

Sometimes Autopilot cannot tell whether your new message means:

1. continue the current workflow
2. create a new independent workflow
3. create a follow-up workflow from the current one

When that happens, it pauses and asks you to choose.

This confirmation is now persisted, so a later `workflow_answer` can continue reliably.

## FAQ

### Q: I typed `/ap-doc` and did not see OpenCode command suggestions. Is it broken?

No.

`/ap-doc:` is an Autopilot inline directive, not an OpenCode slash command.

Use it directly in message text like this:

```text
Please start workflow.
/ap-doc: docs/requirement.md
```

### Q: What does `/ap-doc:` actually do?

It tells Autopilot that a specific document path is an explicit workflow input source.

It does not create a host command. It does not appear in slash-command completion.

### Q: Autopilot asked whether to continue the current task or create a new one. What should I choose?

- Choose **continue current workflow** if you are still working on the same delivery round.
- Choose **new independent workflow** if this is a separate request.
- Choose **follow-up workflow** if it is the same topic but a new round/extension.

### Q: I replied with a choice number before, and the workflow got stuck. What should happen now?

Autopilot now persists these task-relationship confirmations and accepts payloads such as:

- `{"choice": 1}`
- `{"choice": 2}`
- `{"intentChoice": 2, "intentText": "创建新的独立任务"}`

So the decision should continue reliably instead of asking the same question forever.

### Q: What is the difference between `workflow_resume` and `workflow_resync`?

- `workflow_resume`: continue a blocked workflow decision
- `workflow_resync`: rerun review/test after out-of-band code edits

### Q: When should I use `ap-doctor`?

Use `ap-doctor` when a workflow looks abnormal and you want a short diagnosis plus next-step suggestion.

Typical cases:

- workflow is blocked and you want to know whether to resume or resync
- `develop` still looks like a template or unfinished repair
- the workflow seems stuck with no visible progress
- `workflow_status` only gives you a hint and you want a simpler diagnosis

Example:

```text
bun run src/cli.ts ap-doctor wf-123
```

### Q: What does `workflow_resume fix` do?

It tells Autopilot to return from a blocked review/test situation back to `develop` so the issue can be fixed.

### Q: What does `workflow_resume accept` do?

It records that you accept the current blocked state and want the workflow to continue or finish if allowed by the phase logic.

### Q: Why did Autopilot not go straight into a brand-new workflow?

Because your message may have looked like a continuation of an existing workflow. Autopilot now prefers asking instead of guessing.

### Q: Why did plan approval not auto-run?

Because plan approval is a human confirmation point. The expected behavior is:

1. show the full approval block
2. wait for your explicit confirmation
3. only then use `workflow_approve`

### Q: Will long artifacts blow up later prompts?

Autopilot now compresses injected artifacts by key markdown sections before falling back to truncation. This is rule-based compression, not a second AI summarization pass.

### Q: What if an artifact has missing headings, empty sections, or placeholder content?

Autopilot now handles these more defensively during prompt compression:

- skips empty sections
- filters placeholder-only sections
- falls back to broader section scanning
- falls back to truncation if no useful structure is found

## For project-specific tuning

Autopilot still supports project/global config in:

- `~/.config/opencode/autopilot.json`
- `<project>/.workflow-harness/autopilot.json`

But if you are just using the plugin, you can ignore config and start with the defaults.
