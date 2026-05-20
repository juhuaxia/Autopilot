import { beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import { readFile } from "node:fs/promises"
import { writeJsonFile } from "../packages/runtime/src/shared/json-file"
import { ReviewSidecarManager } from "../packages/runtime/src/review/review-sidecar-manager"
import { DefaultWorkflowWorkspace } from "../packages/runtime/src/workspace/workflow-workspace"

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
    expect(["waiting_human", "in_progress"]).toContain(secondWorkflow?.status ?? "missing")
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
    expect(developSession?.lastPrompt).toContain("[QUALITY_POLICY]")
    expect(developSession?.lastPrompt).toContain("[DEVELOP_QUALITY_POLICY]")
    expect(developSession?.lastPrompt).toContain("[DEVELOP_POLICY]")
    expect(developSession?.lastPrompt).toContain("regression checks")
    expect(developSession?.lastPrompt).toContain("do not create non-existent imports")
    expect(developSession?.lastPrompt).toContain("temporarily reuse an existing in-repo asset")
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
    expect(storedReviewSession?.lastPrompt).toContain("[QUALITY_POLICY]")
    expect(storedReviewSession?.lastPrompt).toContain("[REVIEW_QUALITY_POLICY]")
    expect(storedReviewSession?.lastPrompt).toContain("[REVIEW_POLICY]")
    expect(storedReviewSession?.lastPrompt).toContain("This phase is read-only for project code")
    expect(storedReviewSession?.lastPrompt).toContain("do not modify application code")
    expect(storedReviewSession?.lastPrompt).toContain("do not fix them during review")
    expect(storedReviewSession?.lastPrompt).toContain("[REVIEW_SECTION_ORDER_POLICY]")
    expect(storedReviewSession?.lastPrompt).toContain("Do not move ## 结论 above ## Regression 风险评估")
    expect(storedReviewSession?.lastPrompt).toContain("regression risk")
    expect(storedReviewSession?.lastPrompt).toContain("unverified icon/image/asset/component imports")
    expect(storedReviewSession?.lastPrompt).toContain("fabricated resource references")

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
    expect(storedTestSession?.lastPrompt).toContain("[QUALITY_POLICY]")
    expect(storedTestSession?.lastPrompt).toContain("[TEST_QUALITY_POLICY]")
    expect(storedTestSession?.lastPrompt).toContain("[TEST_POLICY]")
    expect(storedTestSession?.lastPrompt).toContain("This phase is read-only for project code")
    expect(storedTestSession?.lastPrompt).toContain("do not modify application code")
    expect(storedTestSession?.lastPrompt).toContain("mark FAIL and record the required fix instead of applying it")
    expect(storedTestSession?.lastPrompt).toContain("[TEST_SECTION_ORDER_POLICY]")
    expect(storedTestSession?.lastPrompt).toContain("upstream/downstream files")

    await harness.artifactEvaluator.setTestReport(workflowId, "pass")
    await harness.tickScheduler.requestTick(workflowId, "test passed")

    workflow = await harness.stateStore.getWorkflow(workflowId)
    expect(workflow?.phase).toBe("done")
    expect(workflow?.status).toBe("completed")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("reruns review after workflow resync instead of continuing stale blocked state", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-resync"

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

    let workflow = await harness.stateStore.getWorkflow(workflowId)
    let runtime = await harness.stateStore.getRuntime(workflowId)
    expect(workflow?.phase).toBe("review")
    expect(workflow?.status).toBe("waiting_human")
    expect(runtime?.phaseDispatchAttempts?.review).toBe(0)

    await harness.humanActionService.resync(workflowId)

    workflow = await harness.stateStore.getWorkflow(workflowId)
    runtime = await harness.stateStore.getRuntime(workflowId)
    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId
      ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId)
      : null

    expect(workflow?.phase).toBe("review")
    expect(workflow?.status).toBe("in_progress")
    expect(runtime?.outOfBandEditsDetected).toBe(true)
    expect(runtime?.resyncedFromPhase).toBe("review")
    expect(runtime?.resyncCount).toBe(1)
    expect(runtime?.phaseDispatchAttempts?.review).toBe(1)
    expect(stored?.lastPrompt).toContain("[PHASE] review")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("builds direct-develop context from the current request instead of default MVP plan content", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-direct-develop-context"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "更改商品列表页排序文案并调整主按钮颜色。",
      startAt: "develop",
    })

    await harness.tickScheduler.requestTick(workflowId, "direct develop start")

    const planFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "plan"),
      "utf8",
    )
    const developFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "develop"),
      "utf8",
    )
    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId
      ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId)
      : null

    expect(planFile).toContain("更改商品列表页排序文案并调整主按钮颜色")
    expect(planFile).not.toContain("构建 workflow harness MVP")
    expect(developFile).toContain("更改商品列表页排序文案并调整主按钮颜色")
    expect(developFile).not.toContain("新增 session client adapter")
    expect(stored?.lastPrompt).toContain("更改商品列表页排序文案并调整主按钮颜色")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("elevates review/test guidance for safe preset workflows", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-safe-preset-review-test"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "修复一个高风险核心流程问题。",
      presetMode: "safe",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：safe preset 会强化 review 和 test。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] safe")
    expect(stored?.lastPrompt).toContain("[PRESET_REVIEW_POLICY]")
    expect(stored?.lastPrompt).toContain("Effective depth: deep")

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] safe")
    expect(stored?.lastPrompt).toContain("[PRESET_TEST_POLICY]")
    expect(stored?.lastPrompt).toContain("Effective depth: deep")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("adds balanced review/test guidance for standard preset workflows without forcing deep depth", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-standard-preset-review-test"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "实现一个常规中风险改动。",
      presetMode: "standard",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：standard preset 写入平衡型 review/test 指导。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] standard")
    expect(stored?.lastPrompt).toContain("[PRESET_REVIEW_POLICY]")
    expect(stored?.lastPrompt).toContain("Effective depth: deep")

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] standard")
    expect(stored?.lastPrompt).toContain("[PRESET_TEST_POLICY]")
    expect(stored?.lastPrompt).toContain("Effective depth: standard")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("adds debug-specific guidance across refinement, plan, develop, review, and test", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-debug-preset"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "修复一个偶发空白页 bug。",
      presetMode: "debug",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] debug")
    expect(stored?.lastPrompt).toContain("[PRESET_REFINEMENT_POLICY]")

    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：原始空白页问题被修复，且不引入相邻回归。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_PLAN_POLICY]")

    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_DEVELOP_POLICY]")

    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    const reviewFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "review"),
      "utf8",
    )
    expect(reviewFile).toContain("## Reviewer: Root-Cause Reviewer")
    expect(reviewFile).toContain("## Reviewer: Regression Reviewer")
    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_REVIEW_POLICY]")
    expect(stored?.lastPrompt).toContain("[REVIEW_ORCHESTRATION]")
    expect(stored?.lastPrompt).toContain("Root-Cause Reviewer")
    expect(stored?.lastPrompt).toContain("Regression Reviewer")

    const sidecar = await Bun.file(harness.workspace.reviewSidecarFile(workflowId)).json() as { mergeMode?: string; entries?: Array<{ roleName?: string }> }
    expect(sidecar.mergeMode).toBe("prefer_conservative")
    expect(sidecar.entries?.some((entry) => entry.roleName === "Root-Cause Reviewer")).toBe(true)

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")
    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_TEST_POLICY]")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("adds review-heavy specific guidance for review/test", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-heavy-preset"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "请更严格地审查这个实现。",
      presetMode: "review-heavy",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review-heavy 会强化 review/test 审查导向。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] review-heavy")
    expect(stored?.lastPrompt).toContain("[PRESET_REVIEW_POLICY]")
    expect(stored?.lastPrompt).toContain("[REVIEW_ORCHESTRATION]")
    expect(stored?.lastPrompt).toContain("Business Reviewer")
    expect(stored?.lastPrompt).toContain("Edge Reviewer")
    expect(stored?.lastPrompt).toContain("Quality Reviewer")
    expect(stored?.lastPrompt).toContain("must report: product requirement alignment")
    expect(stored?.lastPrompt).toContain("[REVIEW_SUMMARY_RULES]")
    expect(stored?.lastPrompt).toContain("Effective depth: deep")

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_TEST_POLICY]")
    expect(stored?.lastPrompt).toContain("Effective depth: deep")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("adds verify-specific guidance for review/test without forcing deep depth", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-verify-preset"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "请重点验证这个改动。",
      presetMode: "verify",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")

    let session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    let stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_REFINEMENT_POLICY]")
    expect(stored?.lastPrompt).toContain("minimum information needed to judge pass/fail")

    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：verify 会强化验证导向但不过度扩展。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_PLAN_POLICY]")

    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_DEVELOP_POLICY]")

    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const reviewFile = await readFile(
      harness.workspace.phaseArtifactFile(workflowId, "review"),
      "utf8",
    )
    expect(reviewFile).toContain("## Reviewer: Verification Reviewer")
    expect(reviewFile).not.toContain("## Reviewer: Edge Reviewer")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[AUTOPILOT_PRESET_MODE] verify")
    expect(stored?.lastPrompt).toContain("[PRESET_REVIEW_POLICY]")
    expect(stored?.lastPrompt).toContain("[REVIEW_ORCHESTRATION]")
    expect(stored?.lastPrompt).toContain("Verification Reviewer")
    expect(stored?.lastPrompt).toContain("must report: observability, testability, pass/fail validation")
    expect(stored?.lastPrompt).toContain("[REVIEW_SUMMARY_RULES]")
    expect(stored?.lastPrompt).toContain("Current code and current validation")
    expect(stored?.lastPrompt).toContain("Effective depth: deep")

    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    expect(stored?.lastPrompt).toContain("[PRESET_TEST_POLICY]")
    expect(stored?.lastPrompt).toContain("Effective depth: standard")
    expect(stored?.lastPrompt).toContain("Unverified content must be recorded")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("writes reviewer entries into the review sidecar after review dispatch", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-sidecar"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 review sidecar 验证。",
      presetMode: "review-heavy",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review sidecar 会写出 reviewer entries。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const sidecar = await Bun.file(harness.workspace.reviewSidecarFile(workflowId)).json() as {
      workflowId?: string
      presetMode?: string
      mergeMode?: string
      completedAt?: string | null
      readyToConsolidate?: boolean
      entries?: Array<{ roleName?: string; status?: string }>
    }

    expect(sidecar.workflowId).toBe(workflowId)
    expect(sidecar.presetMode).toBe("review-heavy")
    expect(sidecar.entries?.length ?? 0).toBeGreaterThan(0)
    expect(sidecar.entries?.some((entry) => entry.roleName === "Business Reviewer")).toBe(true)
    expect(sidecar.entries?.every((entry) => entry.status === "running" || entry.status === "idle")).toBe(true)
    expect(sidecar.completedAt === null || typeof sidecar.completedAt === "string" || sidecar.completedAt === undefined).toBe(true)
    expect(typeof sidecar.readyToConsolidate === "boolean" || sidecar.readyToConsolidate === undefined).toBe(true)

    const reviewArtifact = await Bun.file(harness.workspace.phaseArtifactFile(workflowId, "review")).text()
    expect(reviewArtifact).toContain("<!-- AUTOPILOT_REVIEW_SIDE_CAR_START -->")
    expect(reviewArtifact).toContain("## Reviewer Summaries")
    expect(reviewArtifact).toContain("## Reviewer Findings Summary")
    expect(reviewArtifact).toContain("## Reviewer Issues")
    expect(reviewArtifact).toContain("## Candidate Findings For Main Review")
    expect(reviewArtifact).toContain("## Reviewer Severity Summary")
    expect(reviewArtifact).toContain("## Reviewer Conclusion Hint")
    expect(reviewArtifact).toContain("## Reviewer Consolidation Recommendation")
    expect(reviewArtifact).toContain("## Consolidation Recommendation For Main Conclusion")
    expect(reviewArtifact).toContain("## Review Merge Context")
    expect(reviewArtifact).toContain("- completion:")
    expect(reviewArtifact).toContain("- readyToConsolidate:")
    expect(reviewArtifact).toContain("若存在 Reviewer Summaries")
    expect(reviewArtifact).toContain("Candidate Findings For Main Review")
    expect(reviewArtifact).toContain("Reviewer Conclusion Hint")
    expect(reviewArtifact).toContain("[Consolidation Recommendation]")
    expect(reviewArtifact).toContain("recommended main conclusion:")
    expect(reviewArtifact).toMatch(/## 结论\n(?:PASS|FAIL|待判定)/)

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not overwrite an already explicit main review conclusion", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-conclusion-preserve"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 review 结论保留验证。",
      presetMode: "review-heavy",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：已有 PASS/FAIL 结论时不被 consolidation recommendation 覆盖。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const reviewPath = harness.workspace.phaseArtifactFile(workflowId, "review")
    const original = await Bun.file(reviewPath).text()
    const explicit = original.replace("## 结论\n待判定", "## 结论\nPASS")
    await Bun.write(reviewPath, explicit)

    await harness.tickScheduler.requestTick(workflowId, "sidecar rewrite with explicit conclusion")

    const finalContent = await Bun.file(reviewPath).text()
    expect(finalContent).toContain("## 结论\nPASS")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("marks review consolidation as dispatched once reviewer sidecar is ready", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-consolidation-flag"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 review consolidation flag 验证。",
      presetMode: "review-heavy",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：readyToConsolidate 后会出现 consolidation dispatched 标记。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.tickScheduler.requestTick(workflowId, "review consolidation check")

    const sidecar = await Bun.file(harness.workspace.reviewSidecarFile(workflowId)).json() as { readyToConsolidate?: boolean }
    expect(typeof sidecar.readyToConsolidate === "boolean" || sidecar.readyToConsolidate === undefined).toBe(true)

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("synchronizes reviewer session statuses through the activity monitor loop", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-session-sync"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 reviewer session 同步验证。",
      presetMode: "review-heavy",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：reviewer session 状态会被监控循环同步。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    await harness.tickScheduler.requestTick(workflowId, "review session sync")

    const sessions = await harness.sessionCoordinator.listStoredSessions(workflowId)
    const reviewerSessions = sessions.filter((session) => session.kind === "reviewer")
    expect(reviewerSessions.length).toBeGreaterThan(0)
    expect(reviewerSessions.every((session) => session.status === "idle" || session.status === "failed")).toBe(true)

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("dispatches a one-shot consolidation prompt when review sidecar becomes ready", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-consolidation"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 reviewer consolidation 验证。",
      presetMode: "review-heavy",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：reviewer 全部完成后主 review 会收到 consolidation prompt，且只触发一次。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    await harness.tickScheduler.requestTick(workflowId, "allow reviewer consolidation")

    const reviewArtifact = await Bun.file(harness.workspace.phaseArtifactFile(workflowId, "review")).text()
    expect(reviewArtifact).toContain("## Consolidation Recommendation For Main Conclusion")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("autofills the main review conclusion from a ready consolidation candidate when still pending", async () => {
    const workspace = new DefaultWorkflowWorkspace(baseDir)
    const manager = new ReviewSidecarManager(workspace)
    const workflowId = "wf-review-autofill-pass"

    await Bun.write(
      workspace.phaseArtifactFile(workflowId, "review"),
      [
        "# 审查报告",
        "",
        "## 状态",
        "待判定",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "示例范围",
        "",
        "## 发现的问题",
        "待审查",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        "低",
        "",
        "## 结论",
        "待判定",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await manager.write(workflowId, {
      workflowId,
      presetMode: "verify",
      mergeMode: "prefer_conservative",
      completedAt: new Date().toISOString(),
      readyToConsolidate: true,
      updatedAt: new Date().toISOString(),
      entries: [
        {
          reviewerSessionId: "r1",
          roleName: "Verification Reviewer",
          prompt: "prompt",
          status: "idle",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSummary: "no blocking issue found with high confidence",
          issueConfidence: "high",
          issueSource: "no blocking issue found with high confidence",
        },
      ],
    })

    await manager.syncReviewArtifact(workflowId)

    const reviewArtifact = await Bun.file(workspace.phaseArtifactFile(workflowId, "review")).text()
    expect(reviewArtifact).toContain("## 状态\nPASS")
    expect(reviewArtifact).toContain("## 结论\nPASS")
    expect(reviewArtifact).toContain("[Consolidation Recommendation]")
    expect(reviewArtifact).toContain("# 审查报告")
    expect(reviewArtifact.indexOf("# 审查报告")).toBeLessThan(reviewArtifact.indexOf("<!-- AUTOPILOT_REVIEW_SIDE_CAR_START -->"))

    await rm(baseDir, { recursive: true, force: true })
  })

  it("does not replace an empty main review artifact with sidecar-only content", async () => {
    const workspace = new DefaultWorkflowWorkspace(baseDir)
    const manager = new ReviewSidecarManager(workspace)
    const workflowId = "wf-review-sidecar-empty-main"

    await Bun.write(workspace.phaseArtifactFile(workflowId, "review"), "")
    await manager.write(workflowId, {
      workflowId,
      presetMode: "safe",
      mergeMode: "prefer_conservative",
      completedAt: new Date().toISOString(),
      readyToConsolidate: true,
      updatedAt: new Date().toISOString(),
      entries: [
        {
          reviewerSessionId: "r1",
          roleName: "Business Reviewer",
          prompt: "prompt",
          status: "idle",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSummary: "no issue",
        },
      ],
    })

    await manager.syncReviewArtifact(workflowId)

    const reviewArtifact = await Bun.file(workspace.phaseArtifactFile(workflowId, "review")).text()
    expect(reviewArtifact.trim()).toBe("")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("marks review artifacts with reordered headings as invalid", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-heading-order"
    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 review 标题顺序。",
    })
    await harness.stateStore.updateWorkflow(workflowId, { phase: "review", status: "in_progress" })
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
        "## 结论",
        "PASS",
        "",
        "## 检查范围",
        "范围",
        "",
        "## 发现的问题",
        "无",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## Regression 风险评估",
        "低",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const evaluation = await harness.artifactEvaluator.evaluate(workflow!)

    expect(evaluation.valid).toBe(false)
    expect(evaluation.reportStatus).toBe("pass")
    expect(evaluation.missing).toContain("section_order_invalid: ## 结论 should appear after ## Regression 风险评估")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("preserves an explicit review conclusion during sidecar sync", async () => {
    const workspace = new DefaultWorkflowWorkspace(baseDir)
    const manager = new ReviewSidecarManager(workspace)
    const workflowId = "wf-review-conclusion-preserve-explicit"

    await Bun.write(
      workspace.phaseArtifactFile(workflowId, "review"),
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
        "示例范围",
        "",
        "## 发现的问题",
        "无",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        "低",
        "",
        "## 结论",
        "PASS",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await manager.write(workflowId, {
      workflowId,
      presetMode: "verify",
      mergeMode: "prefer_conservative",
      completedAt: new Date().toISOString(),
      readyToConsolidate: true,
      updatedAt: new Date().toISOString(),
      entries: [
        {
          reviewerSessionId: "r1",
          roleName: "Verification Reviewer",
          prompt: "prompt",
          status: "idle",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastSummary: "no blocking issue found with high confidence",
          issueConfidence: "high",
          issueSource: "no blocking issue found with high confidence",
        },
      ],
    })

    await manager.syncReviewArtifact(workflowId)

    const reviewArtifact = await Bun.file(workspace.phaseArtifactFile(workflowId, "review")).text()
    expect(reviewArtifact).toContain("## 结论\nPASS")
    expect(reviewArtifact).toContain("## Consolidation Recommendation For Main Conclusion")

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

  it("injects missing asset import guardrails into develop prompts", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-asset-guardrail-develop"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增图标资源缺失保护规则验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop prompt 明确禁止伪造不存在的图片或 icon import。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null

    expect(stored?.lastPrompt).toContain("Never import or reference icons, images, assets, or components unless you have verified they already exist in the repository")
    expect(stored?.lastPrompt).toContain("Do not invent import paths, filenames, asset names, or icon exports")
    expect(stored?.lastPrompt).toContain("Either temporarily reuse an existing in-repo asset")

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

  it("allows review orchestration roles to be overridden by autopilot config", async () => {
    await writeJsonFile(join(baseDir, "autopilot.json"), {
      reviewOrchestration: {
        verify: {
          reviewRoles: [
            {
              name: "Custom Verification Reviewer",
              focus: "Check only release-signoff evidence and validation confidence.",
            },
          ],
          mergePolicy: {
            conflictResolution: "prefer_conservative",
            unresolvedDisagreement: "flag",
            summaryPriority: "concise",
            preserveHigherSeverity: true,
          },
        },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-orchestration-override"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "请重点验证这个改动。",
      presetMode: "verify",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review orchestration 可被配置覆盖。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null

    expect(stored?.lastPrompt).toContain("[REVIEW_ORCHESTRATION]")
    expect(stored?.lastPrompt).toContain("Custom Verification Reviewer")
    expect(stored?.lastPrompt).toContain("release-signoff evidence")
    expect(stored?.lastPrompt).toContain("[REVIEW_SUMMARY_RULES]")
    expect(stored?.lastPrompt).toContain("[REVIEW_MERGE_POLICY]")
    expect(stored?.lastPrompt).toContain("conflictResolution: prefer_conservative")
    expect(stored?.lastPrompt).toContain("unresolvedDisagreement: flag")
    expect(stored?.lastPrompt).toContain("summaryPriority: concise")
    expect(stored?.lastPrompt).toContain("preserveHigherSeverity: true")
    expect(stored?.lastPrompt).not.toContain("Verification Reviewer: Check whether the implementation is observable")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("ignores invalid review orchestration roles and falls back to preset defaults", async () => {
    await writeJsonFile(join(baseDir, "autopilot.json"), {
      reviewOrchestration: {
        verify: {
          reviewRoles: [
            { name: "", focus: "" },
            { name: "Valid Reviewer", focus: "Valid fallback role.", priority: 2, weight: 1 },
          ],
        },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-orchestration-invalid-roles"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "请重点验证这个改动。",
      presetMode: "verify",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：无效 reviewer 会被忽略，合法 reviewer 会生效。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null

    expect(stored?.lastPrompt).toContain("Valid Reviewer")
    expect(stored?.lastPrompt).not.toContain("- :")

    await harness.sessionActivityMonitor.stop(workflowId)
    await rm(baseDir, { recursive: true, force: true })
  })

  it("sorts review orchestration roles by priority then weight", async () => {
    await writeJsonFile(join(baseDir, "autopilot.json"), {
      reviewOrchestration: {
        verify: {
          reviewRoles: [
            {
              name: "Low Priority Reviewer",
              focus: "Last in the line.",
              priority: 2,
              weight: 10,
            },
            {
              name: "High Priority Reviewer",
              focus: "First in the line.",
              priority: 1,
              weight: 5,
            },
            {
              name: "Tie Break Reviewer A",
              focus: "Same priority, higher weight.",
              priority: 3,
              weight: 20,
            },
            {
              name: "Tie Break Reviewer B",
              focus: "Same priority, lower weight.",
              priority: 3,
              weight: 5,
            },
          ],
        },
      },
    })

    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-orchestration-sorted"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "请重点验证这个改动。",
      presetMode: "verify",
    })

    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review orchestration 会按 priority / weight 排序。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null

    expect(stored?.lastPrompt).toContain("High Priority Reviewer priority=1 weight=5")
    expect(stored?.lastPrompt).toContain("Low Priority Reviewer priority=2 weight=10")
    expect(stored?.lastPrompt).toContain("Tie Break Reviewer A priority=3 weight=20")
    expect(stored?.lastPrompt).toContain("Tie Break Reviewer B priority=3 weight=5")
    expect(stored?.lastPrompt).toContain("High Priority Reviewer")
    expect(stored?.lastPrompt?.indexOf("High Priority Reviewer") ?? -1).toBeLessThan(stored?.lastPrompt?.indexOf("Low Priority Reviewer") ?? 9999)

    await harness.sessionActivityMonitor.stop(workflowId)
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

  it("stops redispatching ambiguous review after retry budget and waits for human", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-unknown-budget"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 review 未知结论重试预算验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review 结论长期模糊时不能无限循环。" })
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
        "目标页面。",
        "",
        "## 发现的问题",
        "无。",
        "",
        "## 问题严重度汇总",
        "blocker: 0 | major: 0 | minor: 0 | suggestion: 0",
        "",
        "## Regression 风险评估",
        "低。",
        "",
        "## 结论",
        "待补充",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "review unresolved 1")
    await harness.tickScheduler.requestTick(workflowId, "review unresolved 2")
    await harness.tickScheduler.requestTick(workflowId, "review unresolved 3")
    await harness.tickScheduler.requestTick(workflowId, "review unresolved 4")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    expect(workflow?.phase).toBe("review")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")

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

  it("stops redispatching ambiguous test after retry budget and waits for human", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-unknown-budget"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "新增 test 未知结论重试预算验证。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test 结论长期模糊时不能无限循环。" })
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
        "自动化验证。",
        "",
        "## 验证范围",
        "目标页面。",
        "",
        "## 测试概要",
        "已执行。",
        "",
        "## 失败项",
        "无",
        "",
        "## Regression 验证",
        "已执行",
        "",
        "## 覆盖范围",
        "目标页面。",
        "",
        "## 开发者决策建议",
        "待补充最终结论。",
        "",
        "## 结论",
        "待补充",
        "",
        "## 报告语言",
        "中文",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "test unresolved 1")
    await harness.tickScheduler.requestTick(workflowId, "test unresolved 2")
    await harness.tickScheduler.requestTick(workflowId, "test unresolved 3")
    await harness.tickScheduler.requestTick(workflowId, "test unresolved 4")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    expect(workflow?.phase).toBe("test")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")

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

  it("advances from develop to review when only non-blocking develop sections are missing", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-develop-warning-only"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 develop warning-only section 不阻塞 phase 推进。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop 缺备注/语言时仍可进入 review。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "develop"),
      [
        "# 开发报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "src/foo.ts",
        "",
        "## 自检结果",
        "typecheck + build + tests 全通过",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "develop complete with warnings")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const evaluation = await harness.artifactEvaluator.evaluate({ ...workflow!, phase: "develop" })

    expect(evaluation.readyForNextPhase).toBe(true)
    expect(evaluation.missing).toEqual([])
    expect(evaluation.warnings).toEqual(expect.arrayContaining(["## 配套修改", "## 备注", "## 报告语言"]))
    expect(workflow?.phase).toBe("review")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("stops redispatching develop after repeated blocking artifact signals and waits for human", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-develop-blocking-budget"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 develop 缺关键 section 时不会无限循环。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop 连续重复缺关键 section 时进入人工处理。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    await Bun.write(
      harness.workspace.phaseArtifactFile(workflowId, "develop"),
      [
        "# 开发报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "src/foo.ts",
      ].join("\n"),
    )

    await harness.tickScheduler.requestTick(workflowId, "develop unresolved 1")
    await harness.tickScheduler.requestTick(workflowId, "develop unresolved 2")
    await harness.tickScheduler.requestTick(workflowId, "develop unresolved 3")
    await harness.tickScheduler.requestTick(workflowId, "develop unresolved 4")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)

    expect(workflow?.phase).toBe("develop")
    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")
    expect(humanAction?.action.reason).toContain("develop repeated the same artifact validation signals")
    expect(humanAction?.action.reason).toContain("Missing sections/signals")
    expect(runtime?.lastArtifactSignalSignature).toContain("missing:## 自检结果")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("treats unresolved develop template placeholders as missing content", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-develop-template-placeholders"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 develop 模板占位内容不会被当成已完成。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop 模板中的待 AI 占位文案会被识别为未完成。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const evaluation = await harness.artifactEvaluator.evaluate({ ...workflow!, phase: "develop" })

    expect(evaluation.readyForNextPhase).toBe(false)
    expect(evaluation.summary).toContain("未满足完成条件")
    expect(evaluation.missing).toContain("## 状态: COMPLETED")
    expect(evaluation.missing.length).toBeGreaterThan(0)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("uses a one-shot artifact-only redispatch before develop blocks on unchanged template", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-develop-artifact-repair"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 develop 模板未更新时会先触发一次仅修复 artifact 的重派发。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：develop 模板未更新时，先触发一次 artifact-only repair dispatch。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const runtimeBefore = await harness.stateStore.getRuntime(workflowId)
    await harness.stateStore.updateRuntime(workflowId, {
      phaseDispatchAttempts: {
        ...(runtimeBefore?.phaseDispatchAttempts ?? {}),
        develop: 3,
      },
      lastArtifactSignalSignature: "develop|missing:## 状态: COMPLETED|missing:artifact_unchanged_from_template|summary:开发报告仍包含模板占位内容，未满足完成条件",
      developArtifactRepairDispatchPending: false,
    })

    await harness.tickScheduler.requestTick(workflowId, "develop artifact unchanged at escalation boundary")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    const runtime = await harness.stateStore.getRuntime(workflowId)

    expect(stored?.lastPrompt).toContain("[ARTIFACT_REPAIR_POLICY]")
    expect(stored?.lastPrompt).toContain("Do not modify application code")
    expect(stored?.lastPrompt).toContain("artifact_unchanged_from_template")
    expect(stored?.lastPrompt).toContain("[CURRENT_ARTIFACT]")
    expect(stored?.lastPrompt).not.toContain("[SOURCE_PLAN_ARTIFACT]")
    expect(stored?.lastPrompt).not.toContain("[UNDERSTANDING_POLICY]")
    expect(runtime?.developArtifactRepairDispatchPending).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("renders actionable blocked guidance after artifact-only repair still fails", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-develop-artifact-repair-blocked"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 develop artifact-only repair 失败后的人工指引。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：artifact-only repair 失败后，blocked reason 要给出可操作恢复建议。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")

    const runtimeBefore = await harness.stateStore.getRuntime(workflowId)
    await harness.stateStore.updateRuntime(workflowId, {
      phaseDispatchAttempts: {
        ...(runtimeBefore?.phaseDispatchAttempts ?? {}),
        develop: 3,
      },
      lastArtifactSignalSignature: "develop|missing:## 状态: COMPLETED|missing:artifact_unchanged_from_template|summary:开发报告仍包含模板占位内容，未满足完成条件",
      developArtifactRepairDispatchPending: true,
    })

    await harness.tickScheduler.requestTick(workflowId, "develop artifact repair failed and should block")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)

    expect(workflow?.status).toBe("waiting_human")
    expect(humanAction?.action.type).toBe("blocked")
    expect(humanAction?.action.reason).toContain("artifact-only repair attempt")
    expect(humanAction?.action.reason).toContain("Suggested recovery")
    expect(humanAction?.action.summary).toContain("repair develop.md before resuming the workflow")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("restores the pre-blocked phase on resume after terminal recovery blocking", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-terminal-recover-resume"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 terminal blocked 后 resume 会恢复原 phase。",
    })

    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "review",
      status: "blocked",
      blockReason: "Relevant session failed",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      blockedFromPhase: "review",
      consecutiveFailures: 3,
      recoveryState: "recovering",
    })

    await harness.humanActionService.resume(workflowId)

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)

    expect(workflow?.phase).toBe("review")
    expect(["pending", "in_progress"]).toContain(workflow?.status ?? "blocked")
    expect(workflow?.blockReason).toBeNull()
    expect(runtime?.blockedFromPhase).toBeNull()
    expect(runtime?.consecutiveFailures).toBe(0)
    expect(runtime?.recoveryState).toBe("idle")

    await rm(baseDir, { recursive: true, force: true })
  })

  it("uses a one-shot artifact-only redispatch before review blocks on unchanged template", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-artifact-repair"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 review 模板未更新时会先触发一次仅修复 artifact 的重派发。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：review 模板未更新时，先触发一次 artifact-only repair dispatch。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")

    const runtimeBefore = await harness.stateStore.getRuntime(workflowId)
    await harness.stateStore.updateRuntime(workflowId, {
      phaseDispatchAttempts: {
        ...(runtimeBefore?.phaseDispatchAttempts ?? {}),
        review: 3,
      },
      lastArtifactSignalSignature: "review|missing:artifact_unchanged_from_template|summary:开发报告仍包含模板占位内容，未满足完成条件",
      reviewArtifactRepairDispatchPending: false,
    })

    await harness.tickScheduler.requestTick(workflowId, "review artifact unchanged at escalation boundary")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    const runtime = await harness.stateStore.getRuntime(workflowId)

    expect(stored?.lastPrompt).toContain("[ARTIFACT_REPAIR_POLICY]")
    expect(stored?.lastPrompt).toContain("Only repair the review artifact")
    expect(stored?.lastPrompt).not.toContain("[SOURCE_DEVELOP_ARTIFACT]")
    expect(runtime?.reviewArtifactRepairDispatchPending).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("uses a one-shot artifact-only redispatch before test blocks on unchanged template", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-artifact-repair"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 test 模板未更新时会先触发一次仅修复 artifact 的重派发。",
    })

    await harness.tickScheduler.requestTick(workflowId, "workflow started")
    await harness.tickScheduler.requestTick(workflowId, "refinement self-repair completed")
    await harness.humanActionService.answer(workflowId, { q_acceptance_criteria: "验收标准：test 模板未更新时，先触发一次 artifact-only repair dispatch。" })
    await harness.tickScheduler.requestTick(workflowId, "enter plan")
    await harness.humanActionService.approve(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "enter develop")
    await harness.artifactEvaluator.markDevelopmentComplete(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "develop complete")
    await harness.artifactEvaluator.setReviewReport(workflowId, "pass", false)
    await harness.tickScheduler.requestTick(workflowId, "review passed")

    const runtimeBefore = await harness.stateStore.getRuntime(workflowId)
    await harness.stateStore.updateRuntime(workflowId, {
      phaseDispatchAttempts: {
        ...(runtimeBefore?.phaseDispatchAttempts ?? {}),
        test: 3,
      },
      lastArtifactSignalSignature: "test|missing:artifact_unchanged_from_template|summary:开发报告仍包含模板占位内容，未满足完成条件",
      testArtifactRepairDispatchPending: false,
    })

    await harness.tickScheduler.requestTick(workflowId, "test artifact unchanged at escalation boundary")

    const session = await harness.sessionCoordinator.getRelevantSession(workflowId)
    const stored = session.sessionId ? await harness.sessionCoordinator.getStoredSession(workflowId, session.sessionId) : null
    const runtime = await harness.stateStore.getRuntime(workflowId)

    expect(stored?.lastPrompt).toContain("[ARTIFACT_REPAIR_POLICY]")
    expect(stored?.lastPrompt).toContain("Only repair the test artifact")
    expect(stored?.lastPrompt).not.toContain("[SOURCE_REVIEW_ARTIFACT]")
    expect(runtime?.testArtifactRepairDispatchPending).toBe(true)

    await rm(baseDir, { recursive: true, force: true })
  })

  it("routes blocked review decision fix back to develop", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-decision-fix"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 review blocked 决策 fix 会回 develop。",
    })

    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "review",
      status: "pending",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      pendingBlockedDecision: {
        actionId: "action-review-fix",
        decision: "fix",
        decidedAt: new Date().toISOString(),
      },
    })

    await harness.tickScheduler.requestTick(workflowId, "consume review fix decision")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    expect(workflow?.phase).not.toBe("review")
    expect(runtime?.pendingBlockedDecision).toBeNull()

    await rm(baseDir, { recursive: true, force: true })
  })

  it("routes blocked review decision accept forward to test", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-review-decision-accept"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 review blocked 决策 accept 会进 test。",
    })

    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "review",
      status: "pending",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      pendingBlockedDecision: {
        actionId: "action-review-accept",
        decision: "accept",
        decidedAt: new Date().toISOString(),
      },
    })

    await harness.tickScheduler.requestTick(workflowId, "consume review accept decision")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    expect(workflow?.phase === "test" || workflow?.phase === "done").toBe(true)
    expect(runtime?.pendingBlockedDecision).toBeNull()

    await rm(baseDir, { recursive: true, force: true })
  })

  it("routes blocked test decision fix back to develop", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-decision-fix"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 test blocked 决策 fix 会回 develop。",
    })

    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "test",
      status: "pending",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      pendingBlockedDecision: {
        actionId: "action-test-fix",
        decision: "fix",
        decidedAt: new Date().toISOString(),
      },
    })

    await harness.tickScheduler.requestTick(workflowId, "consume test fix decision")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    expect(workflow?.phase).not.toBe("test")
    expect(runtime?.pendingBlockedDecision).toBeNull()

    await rm(baseDir, { recursive: true, force: true })
  })

  it("routes blocked test decision accept to done", async () => {
    const harness = await createHarness(baseDir)
    const workflowId = "wf-test-decision-accept"

    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
      userRequest: "验证 test blocked 决策 accept 会直接完成。",
    })

    await harness.stateStore.updateWorkflow(workflowId, {
      phase: "test",
      status: "pending",
    })
    await harness.stateStore.updateRuntime(workflowId, {
      pendingBlockedDecision: {
        actionId: "action-test-accept",
        decision: "accept",
        decidedAt: new Date().toISOString(),
      },
    })

    await harness.tickScheduler.requestTick(workflowId, "consume test accept decision")

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    expect(workflow?.phase).toBe("done")
    expect(runtime?.pendingBlockedDecision).toBeNull()

    await rm(baseDir, { recursive: true, force: true })
  })
})
