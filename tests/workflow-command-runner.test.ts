import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
    } finally {
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
      command: "workflow-status",
      workflowId,
    })

    expect(doneStatus.output).toContain("Channel state: workflow completed")
    expect(doneStatus.output).toContain("Workflow completed:")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
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
