import { beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import { readFile } from "node:fs/promises"
import { writeJsonFile } from "../packages/runtime/src/shared/json-file"

describe("workflow harness MVP", () => {
  let baseDir = ""

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "workflow-harness-"))
  })

  it("auto progresses to human answers, then approval, then develop", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-1"

      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新增 workflow harness MVP。",
      })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")

    const firstWorkflow = await harness.stateStore.getWorkflow(workflowId)
    const firstRuntime = await harness.stateStore.getRuntime(workflowId)
    const firstAction = await harness.humanActionStore.getCurrent(workflowId)
    const specFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "spec_refinement"),
      "utf8",
    )

    expect(firstWorkflow?.phase).toBe("spec_refinement")
    expect(firstWorkflow?.status).toBe("in_progress")
    expect(firstRuntime?.refinementAttempts).toBe(1)
    expect(firstAction).toBeNull()
    expect(specFile).toContain("# 规格精炼报告")
    expect(specFile).toContain("新增 workflow harness MVP。")
    expect(specFile).toContain("## 疑问清单")
    expect(specFile).toContain("- [ ]")

    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")

    const waitingWorkflow = await harness.stateStore.getWorkflow(workflowId)
    const waitingRuntime = await harness.stateStore.getRuntime(workflowId)
    const waitingAction = await harness.humanActionStore.getCurrent(workflowId)

    expect(waitingWorkflow?.status).toBe("waiting_human")
    expect(waitingRuntime?.refinementAttempts).toBe(1)
    expect(waitingRuntime?.refinementLastDispatchSummary).toContain("attempt=1")
    expect(waitingRuntime?.refinementEscalationReason).toBe("Autonomous refinement retry budget exhausted")
    expect(waitingAction?.action.type).toBe("need_answers")
    expect(waitingAction?.action.questions?.every((question) => question.canAutoResolve === false)).toBe(true)
    expect(waitingAction?.action.summary).toContain("Autonomous refinement retry budget exhausted")

    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：主链能自动推进到 develop。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    const secondWorkflow = await harness.stateStore.getWorkflow(workflowId)
    const secondAction = await harness.humanActionStore.getCurrent(workflowId)
    const planSession = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const storedPlanSession = planSession.sessionId
      ? await harness.sessionCoordinator.getStoredSession(workflowId, planSession.sessionId)
      : null
    const planFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "plan"),
      "utf8",
    )
    const answeredSpecFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "spec_refinement"),
      "utf8",
    )

    expect(secondWorkflow?.phase).toBe("plan")
    expect(secondWorkflow?.status).toBe("waiting_human")
    expect(secondAction?.action.type).toBe("need_approval")
    expect(answeredSpecFile).toContain("验收标准：主链能自动推进到 develop。")
    expect(answeredSpecFile).toContain("## 准入结论")
    expect(answeredSpecFile).toContain("READY_FOR_PLAN")
    expect(planFile).toContain("## 需求摘要")
    expect(planFile).toContain("新增 workflow harness MVP。")
    expect(planFile).not.toContain("[USER_PROMPT]")
    expect(planFile).toContain("待 AI 输出分步骤实现方案")
    expect(planFile).toContain("回归验证建议")
    expect(storedPlanSession?.lastPrompt).toContain("[PHASE] plan")
    expect(storedPlanSession?.lastPrompt).toContain("[SOURCE_REFINEMENT_ARTIFACT]")
    expect(storedPlanSession?.lastPrompt).toContain("[PLAN_POLICY]")
    expect(storedPlanSession?.lastPrompt).toContain("regression considerations")

    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const thirdWorkflow = await harness.stateStore.getWorkflow(workflowId)
    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const developSession = session.sessionId
      ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId)
      : null
    const developFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "develop"),
      "utf8",
    )
    expect(thirdWorkflow?.phase).toBe("develop")
    expect(thirdWorkflow?.status).toBe("in_progress")
    expect(session.sessionId).not.toBeNull()
    expect(session.status).toBe("idle")
    expect(developFile).toContain("## 修改文件")
    expect(developFile).toContain("待 AI 结合代码探索结果补充。")
    expect(developFile).toContain("待 AI 在完成实现后补充测试、构建、自检证据")
    expect(developFile).toContain("回归检查结果")
    expect(developSession?.lastPrompt).toContain("[PHASE] develop")
    expect(developSession?.lastPrompt).toContain("[SOURCE_PLAN_ARTIFACT]")
    expect(developSession?.lastPrompt).toContain("[DEVELOP_POLICY]")
    expect(developSession?.lastPrompt).toContain("regression checks")
    expect(developSession?.lastPrompt).toContain("[COMPLETION_POLICY]")

    await harness.sessionActivityMonitor.stop(workflowId)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("keeps refinement waiting when the user answer is still non-specific", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-refinement-nonspecific"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增一个真实业务页面。",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "请按照文档内容自行补充缺失内容" })
    await harness.tickScheduler.requestTick(workflowId, "retry refinement with unresolved answer")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)

    expect(workflow?.phase).toBe("spec_refinement")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("need_answers")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("re-enters the engine when a session becomes idle", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-monitor"

      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新增 session monitor 自动回流验证。",
      })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：session idle 后 workflow 可继续推进。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("develop")
    expect(workflow?.status).toBe("in_progress")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("routes develop -> review -> test -> done on pass reports", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-full-pass"

      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新增 workflow 全链路通过验证。",
      })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：workflow 可从 refinement 推进到 done。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    let workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("review")
    const reviewSession = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const storedReviewSession = reviewSession.sessionId
      ? await harness.sessionCoordinator.getStoredSession(workflowId, reviewSession.sessionId)
      : null
    const reviewFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "review"),
      "utf8",
    )
    expect(reviewFile).toContain("## 检查范围")
    expect(reviewFile).toContain("## 发现的问题")
    expect(reviewFile).toContain("待 AI 审查开发产物后补充。")
    expect(reviewFile).toContain("回归风险判断")
    expect(storedReviewSession?.lastPrompt).toContain("[PHASE] review")
    expect(storedReviewSession?.lastPrompt).toContain("[SOURCE_DEVELOP_ARTIFACT]")
    expect(storedReviewSession?.lastPrompt).toContain("[REVIEW_POLICY]")
    expect(storedReviewSession?.lastPrompt).toContain("regression risk")

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("test")
    const testSession = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const storedTestSession = testSession.sessionId
      ? await harness.sessionCoordinator.getStoredSession(workflowId, testSession.sessionId)
      : null
    const testFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "test"),
      "utf8",
    )
    expect(testFile).toContain("## 测试策略")
    expect(testFile).toContain("待 AI 根据 review 结果与实现风险补充测试策略")
    expect(testFile).toContain("## 失败项")
    expect(testFile).toContain("回归验证")
    expect(storedTestSession?.lastPrompt).toContain("[PHASE] test")
    expect(storedTestSession?.lastPrompt).toContain("[SOURCE_REVIEW_ARTIFACT]")
    expect(storedTestSession?.lastPrompt).toContain("[TEST_POLICY]")
    expect(storedTestSession?.lastPrompt).toContain("previously working features")

    await harness.artifactEvaluator.setTestReport(workflowId, "pass")
    await harness.tickScheduler.requestTick(workflowId, "test passed")

    workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("done")
    expect(workflow?.status).toBe("completed")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("injects requiredSkills into develop and test phase prompts", async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), "workflow-phase-skills-"))
    await Bun.write(join(skillRoot, "frontend-design.md"), "# frontend-design\nUse existing components first.\n")
    await Bun.write(join(skillRoot, "playwright.md"), "# playwright\nPrefer browser verification for critical flows.\n")

    await writeJsonFile(join(baseDir, "autopilot.json"), {
      skillRoots: [skillRoot],
      phases: {
        develop: { requiredSkills: ["frontend-design"] },
        test: { requiredSkills: ["playwright"] },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-phase-skill-injection"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 workflow skill 注入验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop/test prompt 中带上 requiredSkills。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[REQUIRED_SKILLS]")
    expect(stored?.lastPrompt).toContain("frontend-design")
    expect(stored?.lastPrompt).toContain(join(skillRoot, "frontend-design.md"))
    expect(stored?.lastPrompt).toContain("[SKILL_CONTENT]")
    expect(stored?.lastPrompt).toContain("Use existing components first.")

    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[REQUIRED_SKILLS]")
    expect(stored?.lastPrompt).toContain("playwright")
    expect(stored?.lastPrompt).toContain(join(skillRoot, "playwright.md"))
    expect(stored?.lastPrompt).toContain("Prefer browser verification for critical flows.")

    await rm(skillRoot, { recursive: true, force: true })
    await rm(baseDir, { recursive: true, force: true })
  })

  it("injects requiredSkills into plan and review phase prompts", async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), "workflow-phase-skills-plan-review-"))
    await Bun.write(join(skillRoot, "risk-planning.md"), "# risk-planning\nBreak work down by acceptance and risk.\n")
    await Bun.write(join(skillRoot, "ui-review.md"), "# ui-review\nFocus on visual consistency and regression risk.\n")

    await writeJsonFile(join(baseDir, "autopilot.json"), {
      skillRoots: [skillRoot],
      phases: {
        plan: { requiredSkills: ["risk-planning"] },
        review: { requiredSkills: ["ui-review"] },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-phase-skill-injection-plan-review"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 workflow plan/review skill 注入验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：plan/review prompt 中带上 requiredSkills。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[REQUIRED_SKILLS]")
    expect(stored?.lastPrompt).toContain("risk-planning")
    expect(stored?.lastPrompt).toContain(join(skillRoot, "risk-planning.md"))
    expect(stored?.lastPrompt).toContain("Break work down by acceptance and risk.")

    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[REQUIRED_SKILLS]")
    expect(stored?.lastPrompt).toContain("ui-review")
    expect(stored?.lastPrompt).toContain(join(skillRoot, "ui-review.md"))
    expect(stored?.lastPrompt).toContain("Focus on visual consistency and regression risk.")

    await rm(skillRoot, { recursive: true, force: true })
    await rm(baseDir, { recursive: true, force: true })
  })

  it("injects requiredSkills into spec refinement prompts", async () => {
    const skillRoot = await mkdtemp(join(tmpdir(), "workflow-phase-skills-refinement-"))
    await Bun.write(join(skillRoot, "clarity-guide.md"), "# clarity-guide\nResolve ambiguity before plan.\n")

    await writeJsonFile(join(baseDir, "autopilot.json"), {
      skillRoots: [skillRoot],
      phases: {
        spec_refinement: { requiredSkills: ["clarity-guide"] },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-phase-skill-injection-refinement"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 workflow refinement skill 注入验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null

    expect(stored?.lastPrompt).toContain("[REQUIRED_SKILLS]")
    expect(stored?.lastPrompt).toContain("clarity-guide")
    expect(stored?.lastPrompt).toContain(join(skillRoot, "clarity-guide.md"))
    expect(stored?.lastPrompt).toContain("Resolve ambiguity before plan.")

    await rm(skillRoot, { recursive: true, force: true })
    await rm(baseDir, { recursive: true, force: true })
  })

  it("renders missing skill names and config warnings without breaking dispatch", async () => {
    await writeJsonFile(join(baseDir, "autopilot.json"), {
      skillRoots: [join(baseDir, "missing-skills-root")],
      phases: {
        develop: { requiredSkills: ["missing-skill"] },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-missing-skill-warning"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增缺失 skill 告警验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：缺失 skill 时仍可继续 dispatch，但 prompt 里要有告警。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null

    expect(stored?.lastPrompt).toContain("[MISSING_SKILLS]")
    expect(stored?.lastPrompt).toContain("missing-skill")
    expect(stored?.lastPrompt).toContain("[CONFIG_WARNINGS]")
    expect(stored?.lastPrompt).toContain("Skill root not found or unreadable")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("loops review fail with blocker back to develop and increments iteration", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-loop"

      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新增 review loop back 验证。",
      })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review blocker 会回到 develop 且迭代数加一。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.tickScheduler.requestTick(workflowId, "continue review")

    await harness.artifactEvaluator.setReviewReport(workflowId, "fail", true)
    await harness.tickScheduler.requestTick(workflowId, "review failed blocker")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("develop")
    expect(workflow?.status).toBe("in_progress")
    expect(workflow?.iteration).toBe(1)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("pauses on test fail for human decision instead of auto-looping", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-blocked"

      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "新增 test fail 阻塞验证。",
      })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test fail 后等待人工决策。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.tickScheduler.requestTick(workflowId, "continue review")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")
    await harness.tickScheduler.requestTick(workflowId, "continue test")

    await harness.artifactEvaluator.setTestReport(workflowId, "fail")
    await harness.tickScheduler.requestTick(workflowId, "test failed")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    expect(workflow?.phase).toBe("test")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not advance review with COMPLETED status when conclusion is fail", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-completed-fail"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 review completed/fail 判定验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review 结论 FAIL 时不能推进到 test。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "review"),
      [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "ai-e-detail 文案与 hello-world 路由",
        "",
        "## 组件复用验收结果（如适用）",
        "不适用",
        "",
        "## Section 验收映射检查结果（如适用）",
        "不适用",
        "",
        "## 发现的问题",
        "1. medium: 文案替换不完整。",
        "",
        "## 问题严重度汇总",
        "blocker: 0\nhigh: 0\nmedium: 1\nlow: 0",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        "低",
        "",
        "## 结论",
        "FAIL",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "review completed but failed")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    expect(workflow?.phase).toBe("review")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("advances review when pass conclusion exists even if optional sections are omitted", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-pass-optional-sections"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 review 可选 section 缺失时仍可通过的验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review 结论 PASS 时，即使可选 section 未填写，也要推进到 test。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "review"),
      [
        "# 审查报告",
        "",
        "## 状态",
        "PASS",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "ai-e-detail 文案与 hello-world 路由",
        "",
        "## 发现的问题",
        "无。",
        "",
        "## 问题严重度汇总",
        "blocker: 0 | major: 0 | minor: 0 | suggestion: 0",
        "",
        "## Regression 风险评估",
        "极低。",
        "",
        "## 结论",
        "PASS",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "review passed with optional sections omitted")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("test")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not continue test when status is COMPLETED but conclusion is fail", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-completed-fail"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 test completed/fail 判定验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test 结论 FAIL 时不能继续重跑。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "test"),
      [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "静态校验与 lint。",
        "",
        "## 验证范围",
        "文案替换与新增路由。",
        "",
        "## 测试概要",
        "发现失败态文案未替换。",
        "",
        "## 测试证据",
        "SUFFICIENT",
        "",
        "## 新增页面专项验证（如适用）",
        "不适用",
        "",
        "## Figma 高保真验证（如适用）",
        "不适用",
        "",
        "## Key Visual Elements 验证（如适用）",
        "不适用",
        "",
        "## 失败项",
        "1. medium: 失败态文案未替换。",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 验证",
        "未通过",
        "",
        "## 覆盖范围",
        "目标文案与路由存在性。",
        "",
        "## 开发者决策建议",
        "建议修复后重测。",
        "",
        "## 结论",
        "FAIL",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "test completed but failed")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    expect(workflow?.phase).toBe("test")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not treat COMPLETED status as pass when conclusion exists but is unresolved", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-completed-unresolved-conclusion"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 test conclusion authoritative 验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：有结论字段但未明确 pass/fail 时不能视为通过。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "test"),
      [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "静态校验。",
        "",
        "## 验证范围",
        "目标页面。",
        "",
        "## 测试概要",
        "测试已执行。",
        "",
        "## 测试证据",
        "SUFFICIENT",
        "",
        "## 新增页面专项验证（如适用）",
        "不适用",
        "",
        "## Figma 高保真验证（如适用）",
        "不适用",
        "",
        "## Key Visual Elements 验证（如适用）",
        "不适用",
        "",
        "## 失败项",
        "无",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 验证",
        "已执行",
        "",
        "## 覆盖范围",
        "目标页面",
        "",
        "## 开发者决策建议",
        "待补充结论。",
        "",
        "## 结论",
        "待补充",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "test unresolved conclusion")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("test")
    expect(workflow?.status).toBe("in_progress")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not allow test to pass when evidence is still manual-only", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-insufficient-evidence"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 test 证据充分性验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test 只有在证据充分时才允许 done。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "test"),
      [
        "# 测试报告",
        "",
        "## 状态",
        "通过",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "以静态检查为主。",
        "",
        "## 验证范围",
        "新增页面与既有页面文案。",
        "",
        "## 测试概要",
        "建议在浏览器中做一次人工走查。",
        "",
        "## 新增页面专项验证（如适用）",
        "不适用",
        "",
        "## Figma 高保真验证（如适用）",
        "不适用",
        "",
        "## Key Visual Elements 验证（如适用）",
        "不适用",
        "",
        "## 失败项",
        "无",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 验证",
        "未自动执行，仅保留人工走查。",
        "",
        "## 覆盖范围",
        "表面结构覆盖。",
        "",
        "## 开发者决策建议",
        "建议在浏览器中做一次人工走查。",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "test pass but insufficient evidence")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("test")
    expect(workflow?.status).toBe("in_progress")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not block test pass on optional sections when evidence is sufficient", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-pass-optional-sections"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 test 可选 section 缺失时仍可推进的验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test 结论 PASS 且证据充分时，即使可选 section 未填写，也可以保持通过判定。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "test"),
      [
        "# 测试报告",
        "",
        "## 状态",
        "PASS",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "自动化校验与已有功能回归验证。",
        "",
        "## 验证范围",
        "目标页面与相关回归范围。",
        "",
        "## 测试概要",
        "测试执行完成，未发现阻塞问题。",
        "",
        "## 失败项",
        "无",
        "",
        "## Regression 验证",
        "通过",
        "",
        "## 覆盖范围",
        "目标页面、关键按钮与相关显示文案。",
        "",
        "## 开发者决策建议",
        "可继续推进。",
        "",
        "## 结论",
        "PASS",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow).not.toBeNull()

    const evaluation = await harness.artifactEvaluator.evaluate(workflow!)

    expect(evaluation.reportStatus).toBe("pass")
    expect(evaluation.missing).not.toContain("## 新增页面专项验证（如适用）")
    expect(evaluation.missing).not.toContain("## Figma 高保真验证（如适用）")
    expect(evaluation.missing).not.toContain("## Key Visual Elements 验证（如适用）")
    expect(evaluation.missing).not.toContain("## 历史遗留观察项（非阻塞，可选）")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not move test to done when the artifact is still draft-like", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-draft-blocked"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 test 草稿态阻止 done 验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test 报告尚未形成明确 PASS/FAIL 结论时不能进入 done。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    const workflowAtTest = await harness.stateStore.getWorkflow(workflowId)
    expect(workflowAtTest?.phase).toBe("test")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "test"),
      [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "待判定",
        "",
        "## 验证范围",
        "待判定",
        "",
        "## 测试概要",
        "待判定",
        "",
        "## 测试证据",
        "待判定",
        "",
        "## 新增页面专项验证（如适用）",
        "待判定",
        "",
        "## Figma 高保真验证（如适用）",
        "待判定",
        "",
        "## Key Visual Elements 验证（如适用）",
        "待判定",
        "",
        "## 失败项",
        "待判定",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "待判定",
        "",
        "## Regression 验证",
        "待判定",
        "",
        "## 覆盖范围",
        "待判定",
        "",
        "## 开发者决策建议",
        "待判定",
        "",
        "## 结论",
        "待判定",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "test draft should not finish")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("test")
    expect(workflow?.status).toBe("in_progress")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("fails spec refinement validation when required sections are missing", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-invalid-spec"

      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: "只有摘要，没有其他 section",
      })

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "spec_refinement"),
      [
        "# 规格精炼报告",
        "",
        "## 原始需求摘要",
        "只有摘要，没有其他 section",
      ].join("\n"),
    )

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow).not.toBeNull()
    const evaluation = await harness.artifactEvaluator.evaluate(workflow!)

    expect(evaluation.valid).toBe(false)
    expect(evaluation.readyForNextPhase).toBe(false)
    expect(evaluation.missing).toContain("## 需求澄清")
    expect(evaluation.missing).toContain("## 准入结论: READY_FOR_PLAN")

    await rm(baseDir, { recursive: true, force: true })
  })
})
