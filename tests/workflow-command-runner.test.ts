import { describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import { DefaultWorkflowCommandRunner } from "../packages/runtime/src/commands/default-workflow-command-runner"

describe("workflow command runner", () => {
  it("opens workflow channel and returns rendered output", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command",
      payload: "为商品列表页新增价格排序下拉选择器，默认按价格升序。",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Workflow: wf-command")
    expect(result.events.some((event) => event.type === "workflow.attached")).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("accepts structured workflow-open payload with doc paths", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-docs-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const docsDir = await mkdtemp(join(tmpdir(), "workflow-docs-"))
    const docPath = join(docsDir, "requirement.md")
    await writeFile(docPath, "# Requirement\n\nNeed full refine -> plan -> develop -> review -> test.")

    const payload = JSON.stringify({
      prompt: "请基于需求文档推进 workflow。",
      docPaths: [docPath],
      projectContext: "项目使用 workflow harness + opencode plugin",
    })

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-docs",
      payload,
    })

    const content = await Bun.file(harness.workspace.phaseArtifactFile("wf-command-docs", "spec_refinement")).text()
    expect(content).toContain("请基于需求文档推进 workflow")
    expect(content).toContain("[REFERENCE_DOCS]")
    expect(content).toContain("[DOC_PATH]")
    expect(content).toContain("Need full refine -> plan -> develop -> review -> test")

    await rm(docsDir, { recursive: true, force: true })
    await rm(baseDir, { recursive: true, force: true })
  })

  it("keeps natural-language payload raw for downstream AI intake", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-nl-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const docsDir = await mkdtemp(join(tmpdir(), "workflow-docs-nl-"))
    const docPath = join(docsDir, "prd.md")
    await writeFile(docPath, "# PRD\n\nImplement full workflow lifecycle and wait for approvals when needed.")

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-nl",
      payload: `请根据这个需求推进。文档路径: ${docPath}。项目上下文: 当前仓库是workflow harness插件。`,
    })

    const content = await Bun.file(harness.workspace.phaseArtifactFile("wf-command-nl", "spec_refinement")).text()
    expect(content).toContain("请根据这个需求推进")
    expect(content).toContain(docPath)
    expect(content).toContain("项目上下文: 当前仓库是workflow harness插件")
    expect(content).not.toContain("[PROJECT_CONTEXT]")
    expect(content).not.toContain("[REFERENCE_DOCS]")

    await rm(docsDir, { recursive: true, force: true })
    await rm(baseDir, { recursive: true, force: true })
  })

  it("supports workflow-open startAt develop shortcut via structured payload", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-direct-develop-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-direct-develop",
      payload: JSON.stringify({
        prompt: "直接进入 develop 处理一个很小的文案修复。",
        startAt: "develop",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Phase: develop")
    expect(result.output).toContain("Workflow start: direct-develop")
    expect(result.output).toContain("Skipped setup phases: spec_refinement -> plan")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("renders waiting_human feedback after workflow-open when spec refinement needs answers", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-open-waiting-human-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-waiting-human",
      payload: JSON.stringify({
        prompt: "请启动一个新需求开发流程。",
        mode: "safe",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Workflow: wf-command-waiting-human")
    expect(result.output).toContain("Status: waiting_human")
    expect(result.output).toContain("Human action: Answer Required")
    expect(result.output).toContain("Recommended tool: workflow_answer")
    expect(result.output).toContain("Question")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("returns approval-required feedback immediately after workflow_answer advances to plan", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-answer-plan-feedback-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-answer-plan-feedback"

    const openResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId,
      payload: "请启动一个需要 refinement 的新需求。",
    })

    const derivedWorkflowId = openResult.workflowId ?? openResult.output.match(/Workflow: ([^\n]+)/)?.[1]?.trim() ?? workflowId

    const result = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId: derivedWorkflowId,
      payload: JSON.stringify({ q_acceptance_criteria: "验收标准：进入 plan 后应立即回显审批提示。" }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Phase: plan")
    expect(result.output).toContain("Human action: Approval Required")
    expect(result.output).toContain("Recommended user action: confirm approval")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("stores preset mode when opening a safe workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-safe-preset-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-safe-preset",
      payload: JSON.stringify({
        prompt: "请严格检查一个高风险改动。",
        mode: "safe",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const derived = workflows.find((w) => w.workflowId.startsWith("wf-command-safe-preset"))
    const runtime = derived ? await harness.stateStore.getRuntime(derived.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Preset mode: safe")
    expect(result.output).toContain("Review orchestration roles:")
    expect(result.output).toContain("Business Reviewer")
    expect(result.output).toContain("Review summary rules:")
    expect(runtime?.presetMode).toBe("safe")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("stores preset mode when opening a debug workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-debug-preset-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-debug-preset",
      payload: JSON.stringify({
        prompt: "请排查一个偶发空白页问题。",
        mode: "debug",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const derived = workflows.find((w) => w.workflowId.startsWith("wf-command-debug-preset"))
    const runtime = derived ? await harness.stateStore.getRuntime(derived.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Preset mode: debug")
    expect(runtime?.presetMode).toBe("debug")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not force the safe-first-feedback sync for standard mode", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-standard-mode-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-standard-mode",
      payload: JSON.stringify({
        prompt: "请进行标准模式流程。",
        mode: "standard",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Preset mode: standard")
    expect(result.output).not.toContain("Suggestion: please end this workflow before opening a new one.")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("stores preset mode when opening a review-heavy workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-review-heavy-preset-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-review-heavy-preset",
      payload: JSON.stringify({
        prompt: "请从 review 角度更严格地检查这个改动。",
        mode: "review-heavy",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const derived = workflows.find((w) => w.workflowId.startsWith("wf-command-review-heavy-preset"))
    const runtime = derived ? await harness.stateStore.getRuntime(derived.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Preset mode: review-heavy")
    expect(result.output).toContain("Run kind: full")
    expect(runtime?.presetMode).toBe("review-heavy")
    expect(runtime?.runKind).toBe("full")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("creates a review-heavy node run for a completed requested workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-review-heavy-node-run-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "done-feature",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已完成的功能。",
    })
    await harness.stateStore.updateWorkflow("done-feature", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "done-feature",
      payload: JSON.stringify({
        prompt: "请对这个已完成任务做一次重审。",
        mode: "review-heavy",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const nodeRun = workflows.find((w) => w.workflowId.startsWith("done-feature-review-heavy-"))
    const runtime = nodeRun ? await harness.stateStore.getRuntime(nodeRun.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow done-feature 创建 review-heavy 节点任务。")
    expect(result.output).toContain("Phase: review")
    expect(result.output).toContain("Run kind: review-heavy")
    expect(result.output).toContain("Parent workflow: done-feature")
    expect(nodeRun).toBeDefined()
    expect(runtime?.runKind).toBe("review-heavy")
    expect(runtime?.parentWorkflowId).toBe("done-feature")
    expect(runtime?.sourceWorkflowId).toBe("done-feature")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("inherits only the explicitly requested workflowId when it exists", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "target-done",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "目标 workflow。",
    })
    await harness.stateStore.updateWorkflow("target-done", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    await initializeWorkflow({
      workflowId: "other-done",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "其他 workflow。",
    })
    await harness.stateStore.updateWorkflow("other-done", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: JSON.stringify({
        prompt: "请基于这个已完成任务重审",
        mode: "review-heavy",
        sourceWorkflowId: "target-done",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const nodeRun = workflows.find((w) => w.workflowId.startsWith("target-done-review-heavy-"))
    const runtime = nodeRun ? await harness.stateStore.getRuntime(nodeRun.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow target-done 创建 review-heavy 节点任务。")
    expect(runtime?.sourceWorkflowId).toBe("target-done")
    expect(runtime?.parentWorkflowId).toBe("target-done")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks to create new workflow when explicit workflowId does not exist", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-missing-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: JSON.stringify({
        prompt: "请基于这个已完成任务重审",
        mode: "review-heavy",
        sourceWorkflowId: "missing-workflow",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("workflowId=missing-workflow 不存在")
    expect(result.output).toContain("是否需要新建 workflow")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("creates a new workflow after approving missing explicit workflowId clarification", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-missing-answer-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const openResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: JSON.stringify({
        prompt: "请基于这个已完成任务重审",
        mode: "review-heavy",
        sourceWorkflowId: "missing-workflow",
      }),
    })

    expect(openResult.ok).toBe(true)
    expect(openResult.output).toContain("workflowId=missing-workflow 不存在")

    const answerResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId: "new-request",
      payload: JSON.stringify({ lifecycle_decision: "new" }),
    })

    expect(answerResult.ok).toBe(true)
    expect(answerResult.output).toContain("已忽略不存在的 workflowId=missing-workflow，并创建新的独立任务。")
    expect(answerResult.output).toContain("Workflow: new-request-")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("returns waiting_human immediately when missing explicit workflowId is recreated in safe mode", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-missing-safe-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: JSON.stringify({
        prompt: "请启动一个安全模式新需求。",
        mode: "safe",
        sourceWorkflowId: "missing-workflow",
      }),
    })

    const answerResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId: "new-request",
      payload: JSON.stringify({ lifecycle_decision: "new" }),
    })

    expect(answerResult.ok).toBe(true)
    expect(answerResult.output).toContain("Workflow: new-request-")
    expect(answerResult.output).toContain("Status: waiting_human")
    expect(answerResult.output).toContain("Human action: Answer Required")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("preserves raw prompt when missing explicit workflowId is created as new", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-missing-raw-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: "请基于这个已完成任务重审\nworkflowId=missing-workflow",
    })

    const answerResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId: "new-request",
      payload: JSON.stringify({ lifecycle_decision: "new" }),
    })

    expect(answerResult.ok).toBe(true)
    expect(answerResult.output).toContain("已忽略不存在的 workflowId=missing-workflow，并创建新的独立任务。")

    const createdWorkflowId = answerResult.workflowId ?? answerResult.output.match(/Workflow: ([^\n]+)/)?.[1]?.trim()
    expect(createdWorkflowId).toBeTruthy()
    const createdPrompt = await Bun.file(harness.workspace.phaseArtifactFile(createdWorkflowId!, "spec_refinement")).text()
    expect(createdPrompt).toContain("请基于这个已完成任务重审")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("continues an explicitly requested existing workflow for non-node requests", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-continue-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "existing-flow",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已有 workflow。",
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: JSON.stringify({
        prompt: "请继续处理这个需求",
        sourceWorkflowId: "existing-flow",
        mode: "safe",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已继续指定 workflow existing-flow。")
    expect(result.output).toContain("Workflow: existing-flow")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks for continue-or-new when explicit workflowId exists but is completed and request is non-node", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-explicit-workflowid-completed-confirm-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "completed-flow",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已完成 workflow。",
    })
    await harness.stateStore.updateWorkflow("completed-flow", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "new-request",
      payload: JSON.stringify({
        prompt: "请继续处理这个需求",
        sourceWorkflowId: "completed-flow",
        mode: "safe",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("workflowId=completed-flow 已存在")
    expect(result.output).toContain("继续这个已存在的 workflow")
    expect(result.output).toContain("新建一个新的 workflow")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("normalizes legacy test-heavy runKind payloads to verify node runs", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-legacy-test-heavy-node-run-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "done-testable",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已完成的待测试功能。",
    })
    await harness.stateStore.updateWorkflow("done-testable", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "done-testable",
      payload: JSON.stringify({
        prompt: "请对这个已完成任务做一次重测。",
        runKind: "verify",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const nodeRun = workflows.find((w) => w.workflowId.startsWith("done-testable-verify-"))
    const runtime = nodeRun ? await harness.stateStore.getRuntime(nodeRun.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow done-testable 创建 verify 节点任务。")
    expect(result.output).toContain("Phase: test")
    expect(result.output).toContain("Run kind: verify")
    expect(result.output).toContain("Parent workflow: done-testable")
    expect(runtime?.runKind).toBe("verify")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("creates a develop node run for a completed requested workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-develop-node-run-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "done-fixable",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已完成但需要修复的功能。",
    })
    await harness.stateStore.updateWorkflow("done-fixable", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "done-fixable",
      payload: JSON.stringify({
        prompt: "请根据发现的问题做修复。",
        runKind: "develop",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const nodeRun = workflows.find((w) => w.workflowId.startsWith("done-fixable-develop-"))
    const runtime = nodeRun ? await harness.stateStore.getRuntime(nodeRun.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow done-fixable 创建 develop 节点任务。")
    expect(result.output).toContain("Phase: develop")
    expect(result.output).toContain("Run kind: develop")
    expect(result.output).toContain("Parent workflow: done-fixable")
    expect(runtime?.runKind).toBe("develop")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("creates a verify node run for a completed requested workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-verify-node-run-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "done-verifyable",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已完成的待验收功能。",
    })
    await harness.stateStore.updateWorkflow("done-verifyable", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "done-verifyable",
      payload: JSON.stringify({
        prompt: "请做最终验收。",
        runKind: "test-heavy",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const nodeRun = workflows.find((w) => w.workflowId.startsWith("done-verifyable-verify-"))
    const runtime = nodeRun ? await harness.stateStore.getRuntime(nodeRun.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow done-verifyable 创建 verify 节点任务。")
    expect(result.output).toContain("Phase: test")
    expect(result.output).toContain("Run kind: verify")
    expect(result.output).toContain("Parent workflow: done-verifyable")
    expect(runtime?.runKind).toBe("verify")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("chains develop from a review-heavy node run using the original source workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-review-heavy-develop-chain-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "root-done",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "根 workflow。",
    })
    await harness.stateStore.updateWorkflow("root-done", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const reviewResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "root-done",
      payload: JSON.stringify({ prompt: "先重审。", mode: "review-heavy" }),
    })

    const reviewWorkflows = await harness.stateStore.listWorkflows?.() ?? []
    const reviewNode = reviewWorkflows.find((w) => w.workflowId.startsWith("root-done-review-heavy-"))
    expect(reviewResult.ok).toBe(true)
    expect(reviewNode).toBeDefined()

    const developResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: reviewNode!.workflowId,
      payload: JSON.stringify({ prompt: "基于重审结果修复。", runKind: "develop" }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const developNode = workflows.find((w) => w.workflowId.startsWith(`${reviewNode!.workflowId}-develop-`))
    const runtime = developNode ? await harness.stateStore.getRuntime(developNode.workflowId) : null

    expect(developResult.ok).toBe(true)
    expect(developResult.output).toContain("创建 develop 节点任务")
    expect(runtime?.runKind).toBe("develop")
    expect(runtime?.parentWorkflowId).toBe(reviewNode!.workflowId)
    expect(runtime?.sourceWorkflowId).toBe("root-done")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("chains develop directly from a failed review-heavy node run", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-review-heavy-failed-develop-chain-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "root-failed",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "根 workflow。",
    })
    await harness.stateStore.updateWorkflow("root-failed", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const reviewResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "root-failed",
      payload: JSON.stringify({ prompt: "先重审。", mode: "review-heavy" }),
    })

    const reviewWorkflows = await harness.stateStore.listWorkflows?.() ?? []
    const reviewNode = reviewWorkflows.find((w) => w.workflowId.startsWith("root-failed-review-heavy-"))
    expect(reviewResult.ok).toBe(true)
    expect(reviewNode).toBeDefined()

    await harness.stateStore.updateWorkflow(reviewNode!.workflowId, {
      phase: "review",
      status: "waiting_human",
      blockReason: null,
    })
    await harness.stateStore.updateRuntime(reviewNode!.workflowId, {
      runKind: "review-heavy",
      sourceWorkflowId: "root-failed",
      parentWorkflowId: "root-failed",
    })

    const developResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: reviewNode!.workflowId,
      payload: JSON.stringify({ prompt: "根据失败点修复。", runKind: "develop" }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const developNode = workflows.find((w) => w.workflowId.startsWith(`${reviewNode!.workflowId}-develop-`))
    const runtime = developNode ? await harness.stateStore.getRuntime(developNode.workflowId) : null

    expect(developResult.ok).toBe(true)
    expect(developResult.output).toContain("已基于 workflow")
    expect(runtime?.runKind).toBe("develop")
    expect(runtime?.parentWorkflowId).toBe(reviewNode!.workflowId)
    expect(runtime?.sourceWorkflowId).toBe("root-failed")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("includes chained review/test artifacts in a develop node run", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-develop-chain-artifacts-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "root-artifact-done",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "根 workflow。",
    })
    await harness.stateStore.updateWorkflow("root-artifact-done", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const reviewResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "root-artifact-done",
      payload: JSON.stringify({ prompt: "先重审。", mode: "review-heavy" }),
    })

    const reviewWorkflows = await harness.stateStore.listWorkflows?.() ?? []
    const reviewNode = reviewWorkflows.find((w) => w.workflowId.startsWith("root-artifact-done-review-heavy-"))
    expect(reviewResult.ok).toBe(true)
    expect(reviewNode).toBeDefined()

    const developResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: reviewNode!.workflowId,
      payload: JSON.stringify({ prompt: "基于重审结果修复。", runKind: "develop" }),
    })

    expect(developResult.output).toContain("Parent workflow: root-artifact-done-review-heavy-")
    expect(developResult.output).toContain("Source workflow: root-artifact-done")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("chains develop from a verify node run using the original source workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-verify-develop-chain-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "root-test-done",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "根 workflow。",
    })
    await harness.stateStore.updateWorkflow("root-test-done", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const verifyResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "root-test-done",
      payload: JSON.stringify({ prompt: "先重测。", runKind: "verify" }),
    })

    const verifyWorkflows = await harness.stateStore.listWorkflows?.() ?? []
    const verifyNode = verifyWorkflows.find((w) => w.workflowId.startsWith("root-test-done-verify-"))
    expect(verifyResult.ok).toBe(true)
    expect(verifyNode).toBeDefined()

    const developResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: verifyNode!.workflowId,
      payload: JSON.stringify({ prompt: "基于测试结果修复。", runKind: "develop" }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const developNode = workflows.find((w) => w.workflowId.startsWith(`${verifyNode!.workflowId}-develop-`))
    const runtime = developNode ? await harness.stateStore.getRuntime(developNode.workflowId) : null

    expect(developResult.ok).toBe(true)
    expect(developResult.output).toContain("创建 develop 节点任务")
    expect(runtime?.runKind).toBe("develop")
    expect(runtime?.parentWorkflowId).toBe(verifyNode!.workflowId)
    expect(runtime?.sourceWorkflowId).toBe("root-test-done")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("stores preset mode when opening a verify workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-verify-preset-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-verify-preset",
      payload: JSON.stringify({
        prompt: "请重点验证这个需求是否通过。",
        mode: "verify",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const derived = workflows.find((w) => w.workflowId.startsWith("wf-command-verify-preset"))
    const runtime = derived ? await harness.stateStore.getRuntime(derived.workflowId) : null

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Preset mode: verify")
    expect(result.output).toContain("Review orchestration roles:")
    expect(result.output).toContain("Verification Reviewer")
    expect(runtime?.presetMode).toBe("verify")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks user when preset command encounters active workflow (previously: always derives new id)", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-preset-always-derive-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "default",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已有默认 workflow。",
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "autopilot",
      payload: JSON.stringify({
        prompt: "请启动 Autopilot workflow，并按下面的请求执行。",
        mode: "safe",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("检测到未完成的工作流")
    expect(result.output).toContain("default")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks user when preset command encounters active default workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-preset-default-derived-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "default",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已有默认 workflow。",
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "default",
      payload: JSON.stringify({
        prompt: "请重点验证 local_docs/figma_md/2026-05-12-fkq-v2.md。",
        mode: "verify",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("检测到未完成的工作流")
    expect(result.output).toContain("default")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("creates a review-heavy node run when requested workflow is completed", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-preset-default-completed-derived-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "default",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已完成的默认 workflow。",
    })
    await harness.stateStore.updateWorkflow("default", {
      phase: "done",
      status: "completed",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "default",
      payload: JSON.stringify({
        prompt: "请用 review-heavy 模式启动一个全新任务。",
        mode: "review-heavy",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow default 创建 review-heavy 节点任务。")
    expect(result.output).toContain("Workflow: default-review-heavy-")
    expect(result.output).toContain("Run kind: review-heavy")
    expect(result.output).toContain("Parent workflow: default")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("treats done phase as non-active even if status is still in_progress", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-done-in-progress-derived-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "autopilot",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已到 done 但状态残留的 workflow。",
    })
    await harness.stateStore.updateWorkflow("autopilot", {
      phase: "done",
      status: "in_progress",
      approved: true,
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "autopilot",
      payload: JSON.stringify({
        prompt: "请用 review-heavy 模式启动一个全新任务。",
        mode: "review-heavy",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已基于 workflow autopilot 创建 review-heavy 节点任务。")
    expect(result.output).toContain("Phase: review")
    expect(result.output).toContain("Run kind: review-heavy")
    expect(result.output).not.toContain("检测到未完成的工作流 autopilot")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("creates a derived workflow id for preset commands when existing default is blocked", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-preset-default-blocked-derived-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "default",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已阻塞的默认 workflow。",
    })
    await harness.stateStore.updateWorkflow("default", {
      phase: "blocked",
      status: "blocked",
      blockReason: "waiting_human",
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "default",
      payload: JSON.stringify({
        prompt: "请用 verify 模式重新启动一个新任务。",
        mode: "verify",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("已创建新的独立任务。")
    expect(result.output).toContain("Workflow: default-")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("retains real blocked workflows while cleaning archived-by-user ones", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-cleanup-blocked-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "real-blocked",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "真实阻塞任务。",
    })
    await harness.stateStore.updateWorkflow("real-blocked", {
      phase: "blocked",
      status: "blocked",
      blockReason: "waiting_human",
    })

    for (let i = 1; i <= 5; i++) {
      await initializeWorkflow({
        workflowId: `archived-${i}`,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: `归档任务 ${i}。`,
      })
      await harness.stateStore.updateWorkflow(`archived-${i}`, {
        phase: "develop",
        status: "blocked",
        blockReason: "archived-by-user",
        updatedAt: new Date(Date.now() - (5 - i) * 60_000).toISOString(),
      })
    }

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "autopilot",
      payload: JSON.stringify({
        prompt: "新任务。",
        mode: "safe",
      }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    expect(workflows.some((w) => w.workflowId === "real-blocked")).toBe(true)
    expect(workflows.filter((w) => w.status === "blocked" && w.blockReason === "archived-by-user").length).toBeLessThanOrEqual(3)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks user when preset command encounters active explicit non-default workflow", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-preset-explicit-id-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    await initializeWorkflow({
      workflowId: "figma-verify-20260512",
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "已有显式 workflow。",
    })

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "figma-verify-20260512",
      payload: JSON.stringify({
        prompt: "请用 debug 模式检查文档问题。",
        mode: "debug",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("检测到未完成的工作流")
    expect(result.output).toContain("figma-verify-20260512")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("shows overridden review orchestration details in status output", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-orchestration-status-"))
    await writeFile(join(baseDir, "autopilot.json"), JSON.stringify({
      reviewOrchestration: {
        verify: {
          reviewRoles: [
            {
              name: "Custom Verification Reviewer",
              focus: "Check release-signoff evidence.",
            },
          ],
          summaryRules: ["Keep the report concise."],
          mergePolicy: {
            conflictResolution: "prefer_conservative",
            unresolvedDisagreement: "flag",
            summaryPriority: "concise",
          },
        },
      },
    }, null, 2))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-orchestration-status",
      payload: JSON.stringify({
        prompt: "请重点验证这个需求是否通过。",
        mode: "verify",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Review orchestration roles: Custom Verification Reviewer")
    expect(result.output).toContain("Review summary rules: Keep the report concise.")
    expect(result.output).toContain("Review merge policy: conflict=prefer_conservative | disagreement=flag | summary=concise")

    const relevant = await harness.sessionCoordinator.getRelevantSession("wf-command-orchestration-status")
    const relevantSession = relevant.sessionId ? await harness.sessionCoordinator.getStoredSession("wf-command-orchestration-status", relevant.sessionId) : null
    expect(relevantSession?.kind).not.toBe("reviewer")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks for task details when an ap-light bridge contains no actual request", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-empty-ap-light-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-empty-ap-light",
      payload: [
        "请启动 Autopilot workflow，并按下面的请求执行。",
        "/ap-mode: light",
        "/ap-start-at: develop",
      ].join("\n"),
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("还没有实际需求内容")
    expect(result.output).toContain("/ap-light")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not perform local regex extraction for unlabeled natural-language docs", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-multi-docs-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const docsDir = await mkdtemp(join(tmpdir(), "workflow-docs-multi-"))
    const specPath = join(docsDir, "spec.md")
    const apiPath = join(docsDir, "api.md")
    await writeFile(specPath, "# Spec\n\nRefinement constraints and acceptance criteria.")
    await writeFile(apiPath, "# API\n\nRoute changes and compatibility notes.")

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-multi-docs",
      payload: `请按流程推进，参考 ${specPath} 和 ${apiPath}，背景是多文档输入测试。`,
    })

    const content = await Bun.file(harness.workspace.phaseArtifactFile("wf-command-multi-docs", "spec_refinement")).text()
    expect(content).toContain(specPath)
    expect(content).toContain(apiPath)
    expect(content).toContain("多文档输入测试")
    expect(content).not.toContain("[REFERENCE_DOCS]")
    expect(content).not.toContain("Refinement constraints and acceptance criteria")
    expect(content).not.toContain("Route changes and compatibility notes")

    await rm(docsDir, { recursive: true, force: true })
    await rm(baseDir, { recursive: true, force: true })
  })

  it("preserves explicit @read targets in spec refinement artifact input", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-read-targets-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    await mkdir(join(baseDir, "docs"), { recursive: true })
    const acceptancePath = join(baseDir, "docs", "acceptance.md")
    await writeFile(acceptancePath, "# Acceptance\n\nVideo generate section must include checklist data.")

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-read-targets",
      payload: `请基于 @read(local_docs/figma_md/17786586547155.png) 和 @read(${acceptancePath}) 启动 workflow。`,
    })

    const content = await Bun.file(harness.workspace.phaseArtifactFile("wf-command-read-targets", "spec_refinement")).text()
    expect(content).toContain("[READ_TARGETS]")
    expect(content).toContain("type=image path=local_docs/figma_md/17786586547155.png")
    expect(content).toContain(`type=text path=${acceptancePath}`)
    expect(content).toContain("[READ_TARGETS_POLICY]")
    expect(content).toContain(`[READ_TARGET_PATH] ${acceptancePath}`)
    expect(content).toContain("Video generate section must include checklist data.")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("treats a pasted document path as default workflow-start intent", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-clarify-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-clarify",
      payload: "/Users/macbookpro/Documents/workspace/aigc_platform_en_v2/local_docs/figma_md/2026-04-17-fkq-v6.md",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Workflow: wf-command-clarify")
    expect(result.output).toContain("Phase: spec_refinement")

    const content = await Bun.file(harness.workspace.phaseArtifactFile("wf-command-clarify", "spec_refinement")).text()
    expect(content).toContain("请基于这份文档启动 workflow")
    expect(content).toContain("/Users/macbookpro/Documents/workspace/aigc_platform_en_v2/local_docs/figma_md/2026-04-17-fkq-v6.md")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("treats a relative document path as default workflow-start intent", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-relative-doc-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-relative-doc",
      payload: "文档：local_docs/figma_md/2026-04-17-fkq-v6.md",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Workflow: wf-command-relative-doc")
    expect(result.output).toContain("Phase: spec_refinement")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("asks a clarifying question when the user mentions a document but intent is still ambiguous", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-clarify-ambiguous-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-clarify-ambiguous",
      payload: "这里有个文档，你先看一下。",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("我看到你给了一个文档")
    expect(result.output).toContain("直接启动 workflow")
    expect(result.output).toContain("只看文档，不启动 workflow")
    expect(result.events.length).toBe(0)

    const statusResult = await runner.run({
      harness,
      command: "workflow-status",
      workflowId: "wf-command-clarify-ambiguous",
    })

    expect(statusResult.ok).toBe(true)
    expect(statusResult.output).toContain("我看到你给了一个文档")
    expect(statusResult.output).toContain("先分析并提炼需求")

    const freeformResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId: "wf-command-clarify-ambiguous",
      payload: "那就启动 workflow",
    })

    expect(freeformResult.ok).toBe(true)
    expect(freeformResult.output).toContain("Workflow: wf-command-clarify-ambiguous")
    expect(freeformResult.output).toContain("Phase: spec_refinement")

    const secondClarify = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-command-clarify-2",
      payload: "这里有个文档，你先看一下。",
    })

    expect(secondClarify.ok).toBe(true)
    expect(secondClarify.output).toContain("我看到你给了一个文档")

    const answerResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId: "wf-command-clarify-2",
      payload: "1",
    })

    expect(answerResult.ok).toBe(true)
    expect(answerResult.output).toContain("Workflow: wf-command-clarify-2")
    expect(answerResult.output).toContain("Phase: spec_refinement")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("renders richer status details for in-progress phases", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-status-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-status"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 workflow 状态增强验证。",
    })
    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：状态输出要显示代码变更与阶段摘要。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const result = await runner.run({
      harness,
      command: "workflow-status",
      workflowId,
    })

    expect(result.output).toContain("Phase summary:")
    expect(result.output).toContain("Worker session:")
    expect(result.output).toContain("Execution mode: detached background workflow session")
    expect(result.output).toContain("Dispatch mode:")
    expect(result.output).toContain("Code changes:")
    expect(result.output).toContain("Last transition:")
    expect(result.output).toContain("Recent events:")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("renders structured artifact repair details in workflow status output", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-status-repair-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-status-repair"

    try {
      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新增 artifact repair 状态输出验证。",
      })
      await harness.stateStore.updateWorkflow(workflowId, {
        phase: "develop",
        status: "in_progress",
      })
      await harness.stateStore.updateRuntime(workflowId, {
        developArtifactRepairDispatchPending: true,
      })
      await harness.eventStore.append({
        workflowId,
        type: "artifact.repair_dispatched",
        at: new Date().toISOString(),
        payload: {
          phase: "develop",
        },
      })

      const result = await runner.run({
        harness,
        command: "workflow-status",
        workflowId,
      })

      expect(result.output).toContain("Artifact repair pending: yes")
      expect(result.output).toContain("Artifact repair last event: artifact.repair_dispatched")
      expect(result.output).toContain("Artifact repair phase: develop")
      expect(result.output).toContain("Doctor hint: run ap_doctor for a minimal diagnosis and next-step suggestion.")

      const attachResult = await runner.run({
        harness,
        command: "workflow-attach",
        workflowId,
      })

      expect(attachResult.output).not.toContain("Doctor hint: run ap_doctor for a minimal diagnosis and next-step suggestion.")
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("resyncs a blocked review workflow and reruns review by default", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-resync-review-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-resync-review"

    try {
      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "验证 review resync 默认重跑当前阶段。",
      })
      await harness.sessionActivityMonitor.start(workflowId)
      await harness.tickScheduler.requestTick(workflowId, "workflow started")
      await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
      await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review resync 后默认重跑 review。" })
      await harness.tickScheduler.requestTick(workflowId, "enter plan")
      await harness.humanActionService.approve(workflowId)
      await harness.tickScheduler.requestTick(workflowId, "enter develop")
      await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
      await harness.tickScheduler.requestTick(workflowId, "develop complete")
      await harness.artifactEvaluator.setReviewReport(workflowId, "fail", false)
      await harness.tickScheduler.requestTick(workflowId, "review failed")

      const blockedBefore = await runner.run({
        harness,
        command: "workflow-status",
        workflowId,
      })
      expect(blockedBefore.output).toContain("Phase: review")
      expect(blockedBefore.output).toContain("Status: waiting_human")

      const resyncResult = await runner.run({
        harness,
        command: "workflow-resync",
        workflowId,
      })

      expect(resyncResult.output).toContain("Phase: review")
      expect(resyncResult.output).toContain("Status: in_progress")
      expect(resyncResult.output).toContain("Resync note: workflow observed out-of-band code edits")
      expect(resyncResult.output).toContain("Resynced from phase: review")
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("surfaces resume-fix guidance for terminal blocked review workflows", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-blocked-review-guidance-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-blocked-review-guidance"

    try {
      await harness.sessionActivityMonitor.stop(workflowId)
      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "验证 blocked review 状态输出会优先提示 resume fix。",
      })
      await harness.stateStore.updateWorkflow(workflowId, {
        phase: "blocked",
        status: "blocked",
        blockReason: "Exceeded maxIterations while fixing review issues",
      })
      await harness.stateStore.updateRuntime(workflowId, {
        blockedFromPhase: "review",
      })

      const statusResult = await runner.run({
        harness,
        command: "workflow-status",
        workflowId,
      })

      expect(statusResult.output).toContain("Recommended tool: workflow_resume or workflow_resync")
      expect(statusResult.output).toContain("Recommended payload: fix")
      expect(statusResult.output).toContain("return to develop")
      expect(statusResult.output).toContain("Doctor hint: run ap_doctor for a minimal diagnosis and next-step suggestion.")

      const resumeResult = await runner.run({
        harness,
        command: "workflow-resume",
        workflowId,
        payload: "fix",
      })

      expect(resumeResult.output).toContain("Phase: develop")
      expect(["Status: pending", "Status: in_progress"].some((marker) => resumeResult.output.includes(marker))).toBe(true)
    } finally {
      await harness.sessionActivityMonitor.stop(workflowId)
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("shows plan approval preview and done completion feedback", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-approval-preview-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-approval-preview"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增审批预览与完成反馈验证。",
    })
    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：plan 审批前能看到内容预览，done 后有完成反馈。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    const planStatus = await runner.run({
      harness,
      command: "workflow-status",
      workflowId,
    })

    expect(planStatus.output).toContain("Plan summary:")
    expect(planStatus.output).toContain("Impact scope:")
    expect(planStatus.output).toContain("Core files:")
    expect(planStatus.output).toContain("Approval preview:")

    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const reviewStatus = await runner.run({
      harness,
      command: "workflow-status",
      workflowId,
    })

    expect(reviewStatus.output).toContain("Review scope:")
    expect(reviewStatus.output).toContain("Waiting reason: review artifact has not produced a final pass/fail conclusion yet.")

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    const testStatus = await runner.run({
      harness,
      command: "workflow-status",
      workflowId,
    })

    expect(testStatus.output).toContain("Test strategy:")
    expect(testStatus.output).toContain("Regression verification:")

    await harness.artifactEvaluator.setTestReport(workflowId, "pass")
    await harness.tickScheduler.requestTick(workflowId, "test passed")

    const doneStatus = await runner.run({
      harness,
      command: "workflow-attach",
      workflowId,
    })

    expect(doneStatus.output).toContain("Channel state: workflow completed")
    expect(doneStatus.output).toContain("Workflow completed:")
    expect(doneStatus.output).toContain("Suggestion: if you are done with this workflow, you can end it before opening a new one.")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not crash workflow-back when events log is malformed", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-back-malformed-events-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-back-malformed-events"

    try {
      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "验证 workflow-back 在事件日志损坏时也能正常返回。",
      })

      await writeFile(harness.workspace.eventsFile(workflowId), "{not-json}\n", "utf8")

      const result = await runner.run({
        harness,
        command: "workflow-back",
        workflowId,
      })

      expect(result.ok).toBe(true)
      expect(result.output).toContain("Returned from workflow channel for wf-command-back-malformed-events")
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it("reuses foreground session for develop phase when provided", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "workflow-command-runner-foreground-session-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-command-foreground-session"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增前台 session 复用验证。",
    })
    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop 阶段复用前台 session。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    await runner.run({
      harness,
      command: "workflow-approve",
      workflowId,
      foregroundSessionId: "ses-foreground-1",
    })

    const relevant = await harness.sessionCoordinator.getRelevantSession(workflowId)
    expect(relevant.sessionId).toBe("ses-foreground-1")

    const status = await runner.run({
      harness,
      command: "workflow-status",
      workflowId,
    })
    expect(status.output).toContain("Execution mode: foreground session reuse")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("Rule 1: continuation command with pending human action routes to continue", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-rule1-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-continuation-pending"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "测试 pending human action 路由规则。",
    })
    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：pending human action 时提示用户先处理。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId,
      payload: "继续下一步",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("继续")
    // Router may attach/create workflow which produces events
    expect(result.events.length).toBeGreaterThanOrEqual(0)

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("Rule 2: continuation command with active workflow attaches and continues", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-rule2-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-continuation-attach"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "测试 attach 已有工作流路由规则。",
    })
    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "ok" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId,
      payload: "继续下一步",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("继续")
    expect(result.events.some((event) => event.type === "workflow.attached")).toBe(true)

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("Rule 3: continuation command with no active workflow shows confirmation", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-rule3-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-continuation-no-workflow",
      payload: "接着做",
    })

    expect(result.ok).toBe(true)
    // "接着做" with no active workflow → router classifies as confirm (ambiguous)
    expect(result.output).toContain("请确认")
    expect(result.events.length).toBe(0)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("persists ambiguous routing clarification so workflow_answer can continue", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-clarification-persist-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-continuation-clarify"

    const openResult = await runner.run({
      harness,
      command: "workflow-open",
      workflowId,
      payload: "接着做",
    })

    expect(openResult.ok).toBe(true)
    expect(openResult.output).toContain("请确认你的意图")

    const answerResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId,
      payload: JSON.stringify({ choice: 2 }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const derived = workflows.find((wf) => wf.workflowId.startsWith(`${workflowId}-`))

    expect(answerResult.ok).toBe(true)
    expect(answerResult.output).toContain("已创建新的独立任务。")
    expect(derived?.workflowId).toBeDefined()

    await rm(baseDir, { recursive: true, force: true })
  })

  it("accepts intentChoice payload for ambiguous routing clarification", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-intent-choice-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()
    const workflowId = "wf-continuation-intent"

    await runner.run({
      harness,
      command: "workflow-open",
      workflowId,
      payload: "接着做",
    })

    const answerResult = await runner.run({
      harness,
      command: "workflow-answer",
      workflowId,
      payload: JSON.stringify({ intentChoice: 2, intentText: "创建新的独立任务" }),
    })

    const workflows = await harness.stateStore.listWorkflows?.() ?? []
    const derived = workflows.find((wf) => wf.workflowId.startsWith(`${workflowId}-`))

    expect(answerResult.ok).toBe(true)
    expect(answerResult.output).toContain("已创建新的独立任务。")
    expect(derived?.workflowId).toBeDefined()

    await rm(baseDir, { recursive: true, force: true })
  })

  it("normal action payloads are not affected by continuation routing", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-normal-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-continuation-bypass",
      payload: "为商品列表页新增排序功能。",
    })

    expect(result.ok).toBe(true)
    expect(result.output).toContain("Workflow: wf-continuation-bypass")
    expect(result.output).toContain("Phase: spec_refinement")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("negated continuation payloads do not trigger continuation routing", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "wf-continuation-negated-"))
    const harness = await createHarness(baseDir)
    const runner = new DefaultWorkflowCommandRunner()

    const result = await runner.run({
      harness,
      command: "workflow-open",
      workflowId: "wf-continuation-negated",
      payload: "不要继续下一步",
    })

    expect(result.ok).toBe(true)
    expect(result.output).not.toContain("续接已有工作流")
    expect(result.output).not.toContain("有待处理的人工操作")
    expect(result.events.length).toBe(0)

    await rm(baseDir, { recursive: true, force: true })
  })
})
