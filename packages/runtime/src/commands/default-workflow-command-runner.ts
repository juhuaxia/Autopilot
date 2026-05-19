import { initializeWorkflow } from "../bootstrap/initialize-workflow"
import { getAutopilotPresetDefinition } from "./autopilot-presets"
import { renderHumanActionBlock } from "../presentation/human-action-renderer"
import { buildWorkflowOpenRequestWithOptions } from "./workflow-open-request"
import {
  classifyWorkflowIntent,
  formatRoutingOutput,
  generateDerivedWorkflowId,
  type WorkflowRoutingDecision,
  type WorkflowRouterInput,
} from "./workflow-router"
import type { WorkflowCommandResult, WorkflowCommandRunner } from "./workflow-command-runner"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { WorkflowEventRecord } from "../events/workflow-event-store"
import { readJsonFile } from "../shared/json-file"
import type { ReviewSidecarFile } from "../review/review-sidecar"
import type { WorkflowState } from "../../../core/src/state/workflow-state"

const ARCHIVE_KEEP_COUNT = 3

function assertWorkflowId(workflowId: string): void {
  if (!workflowId.trim()) {
    throw new Error("workflowId is required for workflow commands")
  }
}

function resolvePresetWorkflowTargetId(requestedWorkflowId: string): string {
  const timestamp = Date.now().toString(36)
  const suffix = `-${timestamp}`
  if (requestedWorkflowId.endsWith(suffix)) {
    return requestedWorkflowId
  }
  return `${requestedWorkflowId}${suffix}`
}

function resolveNodeRunWorkflowTargetId(sourceWorkflowId: string, runKind: string): string {
  const timestamp = Date.now().toString(36)
  return `${sourceWorkflowId}-${runKind}-${timestamp}`
}

function isActiveWorkflow(workflow: WorkflowState): boolean {
  return workflow.phase !== "done" && workflow.status !== "completed" && workflow.status !== "blocked"
}

function getMostRecentActiveWorkflow(workflows: WorkflowState[]): WorkflowState | null {
  return workflows
    .filter(isActiveWorkflow)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null
}

async function findCompletedWorkflow(
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>,
  workflowId: string,
): Promise<WorkflowState | null> {
  const direct = await harness.stateStore.getWorkflow(workflowId)
  if (direct && (direct.phase === "done" || direct.status === "completed")) {
    return direct
  }
  return null
}

async function resolveNodeChainContext(args: {
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>
  workflowId: string
}): Promise<{
  parentWorkflowId: string
  sourceWorkflowId: string
  currentWorkflow: WorkflowState | null
}> {
  const currentWorkflow = await args.harness.stateStore.getWorkflow(args.workflowId)
  const currentRuntime = await args.harness.stateStore.getRuntime(args.workflowId)
  const sourceWorkflowId = currentRuntime?.sourceWorkflowId ?? currentRuntime?.parentWorkflowId ?? currentWorkflow?.workflowId ?? args.workflowId
  const parentWorkflowId = currentWorkflow?.workflowId ?? args.workflowId
  return { parentWorkflowId, sourceWorkflowId, currentWorkflow }
}

async function buildReviewHeavyNodeRunRequest(args: {
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>
  sourceWorkflowId: string
  prompt: string
}): Promise<string> {
  const phases = ["spec_refinement", "plan", "develop", "review", "test"] as const
  const lines = [
    "请基于指定已完成 workflow 的历史 artifacts，对当前代码执行一次独立的 review-heavy 重审。",
    "不要把历史 artifacts 当作通过凭证；它们只用于理解原需求、计划、实现范围、历史风险和测试记录。",
    "本次结论必须基于当前代码、当前仓库状态和客观审查结果重新判断。",
    "不要修改应用代码；只更新本次 review artifact。",
    "",
    `[SOURCE_WORKFLOW_ID] ${args.sourceWorkflowId}`,
  ]
  if (args.prompt.trim()) {
    lines.push("", "[USER_REQUEST]", args.prompt.trim())
  }
  for (const phase of phases) {
    const content = await readFile(args.harness.workspace.phaseArtifactFile(args.sourceWorkflowId, phase), "utf8").catch(() => "")
    if (content.trim()) {
      lines.push("", `[SOURCE_${phase.toUpperCase()}_ARTIFACT]`, content.trim())
    }
  }
  return lines.join("\n")
}

async function buildChainedDevelopRequest(args: {
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>
  sourceWorkflowId: string
  chainWorkflowId: string
  prompt: string
}): Promise<string> {
  const sourcePhases = ["spec_refinement", "plan", "develop", "review", "test"] as const
  const chainPhases = ["review", "test"] as const
  const lines = [
    "请基于当前节点链路中的审查/测试结果，执行一次 develop 修复/开发。",
    "本次开发必须优先吸收上一节点 run 的 findings、失败项和风险判断，而不是只看最初根 workflow。",
    "本次需要修改代码并输出标准 develop artifact。",
    "",
    `[SOURCE_WORKFLOW_ID] ${args.sourceWorkflowId}`,
    `[CHAIN_WORKFLOW_ID] ${args.chainWorkflowId}`,
  ]
  if (args.prompt.trim()) {
    lines.push("", "[USER_REQUEST]", args.prompt.trim())
  }
  for (const phase of sourcePhases) {
    const content = await readFile(args.harness.workspace.phaseArtifactFile(args.sourceWorkflowId, phase), "utf8").catch(() => "")
    if (content.trim()) {
      lines.push("", `[SOURCE_${phase.toUpperCase()}_ARTIFACT]`, content.trim())
    }
  }
  for (const phase of chainPhases) {
    const content = await readFile(args.harness.workspace.phaseArtifactFile(args.chainWorkflowId, phase), "utf8").catch(() => "")
    if (content.trim()) {
      lines.push("", `[CHAIN_${phase.toUpperCase()}_ARTIFACT]`, content.trim())
    }
  }
  return lines.join("\n")
}

async function buildNodeRunRequest(args: {
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>
  sourceWorkflowId: string
  prompt: string
  runKind: "develop" | "verify"
  chainWorkflowId?: string
}): Promise<string> {
  const phases = ["spec_refinement", "plan", "develop", "review", "test"] as const
  const intro = args.runKind === "develop"
    ? "请基于指定 workflow 的历史 artifacts，对当前代码执行一次独立的 develop 修复/开发。"
    : "请基于指定 workflow 的历史 artifacts，对当前代码执行一次独立的 verify 验证。"
  const artifactRule = args.runKind === "develop"
    ? "本次需要修改代码并输出标准 develop artifact。"
    : "不要修改应用代码；只更新本次 verify artifact。"
  const lines = [
    intro,
    "不要把历史 artifacts 当作通过凭证；它们只用于理解原需求、计划、实现范围、历史风险和测试记录。",
    artifactRule,
    "",
    `[SOURCE_WORKFLOW_ID] ${args.sourceWorkflowId}`,
  ]
  if (args.prompt.trim()) {
    lines.push("", "[USER_REQUEST]", args.prompt.trim())
  }
  for (const phase of phases) {
    const content = await readFile(args.harness.workspace.phaseArtifactFile(args.sourceWorkflowId, phase), "utf8").catch(() => "")
    if (content.trim()) {
      lines.push("", `[SOURCE_${phase.toUpperCase()}_ARTIFACT]`, content.trim())
    }
  }
  if (args.chainWorkflowId) {
    for (const phase of ["review", "test"] as const) {
      const content = await readFile(args.harness.workspace.phaseArtifactFile(args.chainWorkflowId, phase), "utf8").catch(() => "")
      if (content.trim()) {
        lines.push("", `[CHAIN_${phase.toUpperCase()}_ARTIFACT]`, content.trim())
      }
    }
  }
  return lines.join("\n")
}

async function archiveCompletedWorkflows(harness: {
  stateStore: { listWorkflows?(): Promise<WorkflowState[]> }
  workspace: { workflowDir(workflowId: string): string }
}, keepCount: number): Promise<void> {
  const workflows = await harness.stateStore.listWorkflows?.() ?? []
  const completedWorkflows = workflows
    .filter((wf) => wf.status === "completed" || (wf.status === "blocked" && wf.blockReason === "archived-by-user"))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  if (completedWorkflows.length <= keepCount) {
    return
  }

  const toRemove = completedWorkflows.slice(keepCount)
  for (const wf of toRemove) {
    try {
      await rm(harness.workspace.workflowDir(wf.workflowId), { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
}

function findHeadingIndex(content: string, heading: string, startIndex = 0): number {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`^${escaped}(?:$|\\s)`, "m")
  const sliced = startIndex > 0 ? content.slice(startIndex) : content
  const match = regex.exec(sliced)
  return match ? match.index + startIndex : -1
}

function extractSection(content: string, heading: string): string {
  const start = findHeadingIndex(content, heading)
  if (start === -1) {
    return ""
  }
  const afterHeading = start + heading.length
  const nextHeading = content.slice(afterHeading).match(/\n##\s+/)
  const end = nextHeading && typeof nextHeading.index === "number"
    ? afterHeading + nextHeading.index
    : content.length
  return content.slice(afterHeading, end).trim()
}

async function buildStatusEnhancements(args: {
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>
  workflow: WorkflowState
  runtime: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>["stateStore"] extends { getRuntime(workflowId: string): Promise<infer T> } ? T | null : null
  events: WorkflowEventRecord[]
}): Promise<string[]> {
  const { harness, workflow, runtime, events } = args
  const evaluation = await harness.artifactEvaluator.evaluate(workflow)
  const artifactContent = await readFile(harness.workspace.phaseArtifactFile(workflow.workflowId, workflow.phase), "utf8").catch(() => "")
  const lines: string[] = []
  const relevantSession = await harness.sessionCoordinator.getRelevantSession(workflow.workflowId)
  const storedSession = relevantSession.sessionId
    ? await harness.sessionCoordinator.getStoredSession(workflow.workflowId, relevantSession.sessionId)
    : null

  if (evaluation.summary) {
    lines.push(`Phase summary: ${evaluation.summary}`)
  }

    if (storedSession?.sessionId) {
      lines.push(`Worker session: ${storedSession.sessionId}`)
      lines.push(`Worker session phase: ${storedSession.phase}`)
      lines.push(`Worker session status: ${relevantSession.status}`)
      lines.push(`Execution mode: ${storedSession.isForegroundPreferred ? "foreground session reuse" : "detached background workflow session"}`)
      if (storedSession.kind === "reviewer") {
        lines.push(`Worker session role: ${storedSession.roleName ?? "unknown"}`)
      }
    }

  if (storedSession?.lastDispatchMode) {
    lines.push(`Dispatch mode: ${storedSession.lastDispatchMode}`)
  }
  if (storedSession?.lastStatusBeforeDispatch) {
    lines.push(`Status before dispatch: ${storedSession.lastStatusBeforeDispatch}`)
  }

  if (runtime?.startMode === "direct-develop") {
    lines.push("Workflow start: direct-develop")
  }
    if (runtime?.presetMode) {
      lines.push(`Preset mode: ${runtime.presetMode}`)
    const presetDefinition = getAutopilotPresetDefinition(runtime.presetMode)
    const configuredReviewOrchestration = harness.resolvedConfig.reviewOrchestration?.[runtime.presetMode]
    const reviewRoles = configuredReviewOrchestration?.reviewRoles?.length
      ? configuredReviewOrchestration.reviewRoles
      : presetDefinition.runtimePolicy.reviewRoles
    const summaryRules = configuredReviewOrchestration?.summaryRules ?? presetDefinition.runtimePolicy.summaryRules
    const mergePolicy = configuredReviewOrchestration?.mergePolicy
    if (reviewRoles?.length) {
      lines.push(`Review orchestration roles: ${reviewRoles.map((role) => role.name).join(" | ")}`)
    }
    if (summaryRules?.length) {
      lines.push(`Review summary rules: ${summaryRules.join(" | ")}`)
    }
    if (mergePolicy) {
      const mergeLabels = [
        mergePolicy.conflictResolution ? `conflict=${mergePolicy.conflictResolution}` : null,
        mergePolicy.unresolvedDisagreement ? `disagreement=${mergePolicy.unresolvedDisagreement}` : null,
        mergePolicy.summaryPriority ? `summary=${mergePolicy.summaryPriority}` : null,
        typeof mergePolicy.preserveHigherSeverity === "boolean" ? `preserveHigherSeverity=${mergePolicy.preserveHigherSeverity}` : null,
      ].filter(Boolean)
      if (mergeLabels.length > 0) {
        lines.push(`Review merge policy: ${mergeLabels.join(" | ")}`)
      }
    }
    const reviewerSessions = (await harness.sessionCoordinator.listStoredSessions(workflow.workflowId))
      .filter((session) => session.kind === "reviewer")
    if (reviewerSessions.length > 0) {
      lines.push(`Reviewer sessions: ${reviewerSessions.map((session) => `${session.roleName ?? session.sessionId}:${session.status}`).join(" | ")}`)
    }
    const reviewSidecar = await readJsonFile<ReviewSidecarFile>(harness.workspace.reviewSidecarFile(workflow.workflowId))
    if (reviewSidecar?.entries?.length) {
      lines.push(`Review sidecar entries: ${reviewSidecar.entries.map((entry) => `${entry.roleName}:${entry.status}`).join(" | ")}`)
      const summaries = reviewSidecar.entries.filter((entry) => entry.lastSummary)
      if (summaries.length > 0) {
        lines.push(`Review sidecar summaries: ${summaries.map((entry) => `${entry.roleName}:${entry.lastSummary}`).join(" | ")}`)
      }
      lines.push(`Review ready to consolidate: ${reviewSidecar.readyToConsolidate ? "yes" : "no"}`)
    }
  }
  if ((runtime?.skippedPhases?.length ?? 0) > 0) {
    lines.push(`Skipped setup phases: ${runtime?.skippedPhases?.join(" -> ")}`)
  }
  if (runtime?.outOfBandEditsDetected) {
    lines.push("Resync note: workflow observed out-of-band code edits")
  }
  if (runtime?.resyncedFromPhase) {
    lines.push(`Resynced from phase: ${runtime.resyncedFromPhase}`)
  }
  if (runtime?.reviewReadyToConsolidate) {
    lines.push("Review ready to consolidate: yes")
  }

  if (evaluation.missing.length > 0) {
    lines.push(`Missing signals: ${evaluation.missing.join(" | ")}`)
  }

  if (evaluation.warnings && evaluation.warnings.length > 0) {
    lines.push(`Warning signals: ${evaluation.warnings.join(" | ")}`)
  }

  const artifactRepairPending = workflow.phase === "develop"
    ? runtime?.developArtifactRepairDispatchPending === true
    : workflow.phase === "review"
      ? runtime?.reviewArtifactRepairDispatchPending === true
      : workflow.phase === "test"
        ? runtime?.testArtifactRepairDispatchPending === true
        : false
  const recentRepairEvent = [...events].reverse().find((event) =>
    event.type === "artifact.repair_dispatched" || event.type === "artifact.repair_blocked",
  )
  if (artifactRepairPending || recentRepairEvent || evaluation.missing.includes("artifact_unchanged_from_template")) {
    lines.push(`Artifact repair pending: ${artifactRepairPending ? "yes" : "no"}`)
    if (evaluation.missing.includes("artifact_unchanged_from_template")) {
      lines.push("Artifact repair signal: artifact_unchanged_from_template")
    }
    if (recentRepairEvent) {
      lines.push(`Artifact repair last event: ${recentRepairEvent.type}`)
      if (recentRepairEvent.payload?.phase) {
        lines.push(`Artifact repair phase: ${String(recentRepairEvent.payload.phase)}`)
      }
    }
  }

  if (workflow.phase === "develop") {
    const changedFiles = extractSection(artifactContent, "## 修改文件")
    const selfCheck = extractSection(artifactContent, "## 自检结果")
    if (changedFiles) {
      lines.push(`Code changes: ${changedFiles}`)
    }
    if (selfCheck) {
      lines.push(`Self-check: ${selfCheck}`)
    }
  }

  if (workflow.phase === "review") {
    const scope = extractSection(artifactContent, "## 检查范围")
    const issues = extractSection(artifactContent, "## 发现的问题")
    const regression = extractSection(artifactContent, "## Regression 风险评估")
    if (scope) {
      lines.push(`Review scope: ${scope}`)
    }
    if (issues) {
      lines.push(`Findings: ${issues}`)
    }
    if (regression) {
      lines.push(`Regression risk: ${regression}`)
    }
    if (workflow.status === "in_progress" && evaluation.reportStatus === "unknown") {
      lines.push("Waiting reason: review artifact has not produced a final pass/fail conclusion yet.")
    }
  }

  if (workflow.phase === "test") {
    const strategy = extractSection(artifactContent, "## 测试策略")
    const failures = extractSection(artifactContent, "## 失败项")
    const regression = extractSection(artifactContent, "## Regression 验证")
    if (strategy) {
      lines.push(`Test strategy: ${strategy}`)
    }
    if (failures) {
      lines.push(`Failures: ${failures}`)
    }
    if (regression) {
      lines.push(`Regression verification: ${regression}`)
    }
    if (workflow.status === "in_progress" && evaluation.reportStatus === "unknown") {
      lines.push("Waiting reason: test artifact has not produced a final pass/fail conclusion yet.")
    }
  }

  if (workflow.phase === "plan") {
    const summary = extractSection(artifactContent, "## 需求摘要")
    const impact = extractSection(artifactContent, "## 影响范围")
    const coreFiles = extractSection(artifactContent, "## 核心修改文件")
    const risk = extractSection(artifactContent, "## 风险评估")
    if (summary) {
      lines.push(`Plan summary: ${summary}`)
    }
    if (impact) {
      lines.push(`Impact scope: ${impact}`)
    }
    if (coreFiles) {
      lines.push(`Core files: ${coreFiles}`)
    }
    if (risk) {
      lines.push(`Plan risks: ${risk}`)
    }
    if (workflow.status === "waiting_human") {
      lines.push("Approval preview: review the plan summary, impacted scope, core files, and risks before approving.")
    }
  }

  if (workflow.phase === "done" || workflow.status === "completed") {
    lines.push("Workflow completed: all workflow phases reached terminal success state.")
    if (evaluation.summary) {
      lines.push(`Completion summary: ${evaluation.summary}`)
    }
  }

  const lastPhaseChange = [...events].reverse().find((event) => event.type === "phase.changed")
  if (lastPhaseChange?.payload?.from && lastPhaseChange.payload?.to) {
    lines.push(`Last transition: ${String(lastPhaseChange.payload.from)} -> ${String(lastPhaseChange.payload.to)}`)
  }

  const recentEvents = events.slice(-3)
  if (recentEvents.length > 0) {
    lines.push(`Recent events: ${recentEvents.map((event) => event.type).join(" -> ")}`)
  }

  return lines
}

type PendingClarification = {
  rawPayload: string
  prompt: string
  options: string[]
  sourceWorkflowId?: string
  mode?: string
}

async function buildWorkflowStatusResult(args: {
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>
  workflowId: string
  clarificationWorkflowId?: string
  prefixOutput?: string
}): Promise<WorkflowCommandResult> {
  const { harness, workflowId, clarificationWorkflowId, prefixOutput } = args
  const workflow = await harness.stateStore.getWorkflow(workflowId)
  const runtime = await harness.stateStore.getRuntime(workflowId)
  const humanAction = await harness.humanActionStore.getCurrent(workflowId)
  const events = await harness.eventStore.list(workflowId)
  const clarification = await readPendingClarification(harness, clarificationWorkflowId ?? workflowId)
  if (!workflow) {
    if (clarification) {
      return {
        ok: true,
        output: [clarification.prompt, ...clarification.options].join("\n"),
        events: [],
        workflowId,
      }
    }
    throw new Error(`Workflow not found: ${workflowId}`)
  }

  const enhancementLines = await buildStatusEnhancements({
    harness,
    workflow,
    runtime,
    events,
  })

  const statusBlock = renderHumanActionBlock({
    workflow,
    runtime,
    humanAction,
    clarification: clarification
      ? { prompt: clarification.prompt, options: clarification.options }
      : null,
    phaseDetails: enhancementLines,
  })

  return {
    ok: true,
    output: prefixOutput
      ? [prefixOutput, "", statusBlock].join("\n")
      : statusBlock,
    events,
    workflowId,
  }
}

function clarificationFilePath(harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>, workflowId: string): string {
  return join(harness.workspace.workflowsRoot(), "..", "clarifications", `${workflowId}.json`)
}

async function renderClarificationIfAny(
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>,
  workflowId: string,
): Promise<WorkflowCommandResult | null> {
  const pending = await readPendingClarification(harness, workflowId)
  if (!pending) {
    return null
  }

  return {
    ok: true,
    output: [
      pending.prompt,
      ...pending.options,
    ].join("\n"),
    events: [],
    workflowId,
  }
}

async function savePendingClarification(
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>,
  workflowId: string,
  payload: PendingClarification,
): Promise<void> {
  const filePath = clarificationFilePath(harness, workflowId)
  await mkdir(join(harness.workspace.workflowsRoot(), "..", "clarifications"), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

async function readPendingClarification(
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>,
  workflowId: string,
): Promise<PendingClarification | null> {
  try {
    return JSON.parse(await readFile(clarificationFilePath(harness, workflowId), "utf8")) as PendingClarification
  } catch {
    return null
  }
}

async function clearPendingClarification(
  harness: Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>,
  workflowId: string,
): Promise<void> {
  try {
    await rm(clarificationFilePath(harness, workflowId))
  } catch {
    return
  }
}

function buildIntentPromptFromChoice(choice: string, rawPayload: string): string {
  const normalized = choice.trim()
  if (normalized.includes("启动") || normalized.includes("workflow") || normalized.includes("开始")) {
    return `请直接启动完整 workflow。
${rawPayload}`
  }
  if (normalized.includes("分析") || normalized.includes("提炼")) {
    return `请先分析文档并提炼需求。
${rawPayload}`
  }
  if (normalized.includes("补全") || normalized.includes("完善")) {
    return `请先补全文档缺失内容，再决定是否启动 workflow。
${rawPayload}`
  }
  if (normalized.includes("总结") || normalized.includes("查看")) {
    return `请只查看并总结文档。
${rawPayload}`
  }
  if (normalized.startsWith("1")) {
    return `请直接启动完整 workflow。
${rawPayload}`
  }
  if (normalized.startsWith("2")) {
    return `请先分析文档并提炼需求。
${rawPayload}`
  }
  if (normalized.startsWith("3")) {
    return `请先补全文档缺失内容，再决定是否启动 workflow。
${rawPayload}`
  }
  return `请只查看并总结文档。
${rawPayload}`
}

export class DefaultWorkflowCommandRunner implements WorkflowCommandRunner {
  async run(args: Parameters<WorkflowCommandRunner["run"]>[0]): Promise<WorkflowCommandResult> {
    const { harness, command, workflowId, payload, foregroundSessionId } = args
    assertWorkflowId(workflowId)

    if (command === "workflow-open") {
      const openRequest = await buildWorkflowOpenRequestWithOptions(payload, process.cwd(), {
        imageSummaryService: harness.imageSummaryService,
      })

      // Skip clarification for routing-capable inputs; only clarify
      // pure document references that lack action intent
      if (openRequest.needsClarification && !openRequest.continuationIntent) {
        await savePendingClarification(harness, workflowId, {
          rawPayload: payload ?? "",
          prompt: openRequest.clarificationQuestion ?? "我需要先确认你的意图。",
          options: openRequest.clarificationOptions ?? [],
          sourceWorkflowId: workflowId,
          ...(openRequest.mode ? { mode: openRequest.mode } : {}),
        })
        const outputLines = [openRequest.clarificationQuestion ?? "我需要先确认你的意图。"]
        if (openRequest.clarificationOptions && openRequest.clarificationOptions.length > 0) {
          outputLines.push(...openRequest.clarificationOptions)
        }
        return {
          ok: true,
          output: outputLines.join("\n"),
          events: [],
          workflowId,
        }
      }

      const workflows = await harness.stateStore.listWorkflows?.() ?? []
      const activeWorkflows = workflows.filter(isActiveWorkflow)

      const currentWorkflow = await harness.stateStore.getWorkflow(workflowId)
      const currentRuntime = await harness.stateStore.getRuntime(workflowId)
      const currentArtifact = currentWorkflow ? await harness.artifactEvaluator.evaluate(currentWorkflow) : null

      const shouldChainDevelopFromFailedNode = openRequest.runKind === "develop"
        && !!currentWorkflow
        && !!currentRuntime?.runKind
        && currentRuntime.runKind !== "full"
        && (currentWorkflow.phase === "review" || currentWorkflow.phase === "test")
        && currentArtifact?.reportStatus === "fail"

      if (shouldChainDevelopFromFailedNode && currentRuntime) {
        const sourceWorkflowId = currentRuntime.sourceWorkflowId ?? currentRuntime.parentWorkflowId ?? workflowId
        const parentWorkflowId = workflowId
        const targetId = resolveNodeRunWorkflowTargetId(parentWorkflowId, "develop")
        const nodeRequest = await buildChainedDevelopRequest({
          harness,
          sourceWorkflowId,
          chainWorkflowId: workflowId,
          prompt: openRequest.prompt,
        })
        await initializeWorkflow({
          workflowId: targetId,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: nodeRequest,
          startAt: "develop",
          runKind: "develop",
          parentWorkflowId,
          sourceWorkflowId,
        })
        if (foregroundSessionId) {
          await harness.stateStore.updateRuntime(targetId, {
            preferredForegroundSessionId: foregroundSessionId,
          })
        }
        await harness.attachService.attach(targetId)
        return buildWorkflowStatusResult({
          harness,
          workflowId: targetId,
          prefixOutput: `已基于 workflow ${parentWorkflowId} 创建 develop 节点任务。`,
        })
      }

      const chainedNodeContext = openRequest.runKind === "develop" || openRequest.runKind === "verify"
        ? await resolveNodeChainContext({ harness, workflowId })
        : null
      const completedRequestedWorkflow = (openRequest.mode === "review-heavy" || openRequest.runKind === "develop" || openRequest.runKind === "verify")
        ? await findCompletedWorkflow(harness, chainedNodeContext?.sourceWorkflowId ?? workflowId)
        : null
      if (completedRequestedWorkflow) {
        const requestedNodeRunKind: "review-heavy" | "develop" | "verify" | undefined = openRequest.mode === "review-heavy"
          ? "review-heavy"
          : openRequest.runKind === "develop" || openRequest.runKind === "verify"
            ? openRequest.runKind
            : undefined
        if (!requestedNodeRunKind) {
          throw new Error("Node run request missing run kind")
        }
        const sourceWorkflowId = chainedNodeContext?.sourceWorkflowId ?? completedRequestedWorkflow.workflowId
        const parentWorkflowId = requestedNodeRunKind === "develop" || requestedNodeRunKind === "verify"
          ? (chainedNodeContext?.parentWorkflowId ?? completedRequestedWorkflow.workflowId)
          : completedRequestedWorkflow.workflowId
        const targetId = resolveNodeRunWorkflowTargetId(parentWorkflowId, requestedNodeRunKind)
        const nodeRequest = requestedNodeRunKind === "review-heavy"
          ? await buildReviewHeavyNodeRunRequest({
              harness,
              sourceWorkflowId,
              prompt: openRequest.prompt,
            })
          : requestedNodeRunKind === "develop" && chainedNodeContext
            ? await buildChainedDevelopRequest({
                harness,
                sourceWorkflowId,
                chainWorkflowId: workflowId,
                prompt: openRequest.prompt,
              })
          : await buildNodeRunRequest({
              harness,
              sourceWorkflowId,
              prompt: openRequest.prompt,
              runKind: requestedNodeRunKind,
              ...(chainedNodeContext ? { chainWorkflowId: workflowId } : {}),
            })
        const startAt = requestedNodeRunKind === "develop"
          ? "develop"
          : requestedNodeRunKind === "verify"
            ? "test"
            : "review"
        const presetMode = requestedNodeRunKind === "review-heavy"
          ? "review-heavy"
          : requestedNodeRunKind === "verify"
            ? "verify"
            : null
        await initializeWorkflow({
          workflowId: targetId,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: nodeRequest,
          startAt,
          ...(presetMode ? { presetMode } : {}),
          runKind: requestedNodeRunKind,
          parentWorkflowId,
          sourceWorkflowId,
        })
        if (foregroundSessionId) {
          await harness.stateStore.updateRuntime(targetId, {
            preferredForegroundSessionId: foregroundSessionId,
          })
        }
        await harness.attachService.attach(targetId)
        return buildWorkflowStatusResult({
          harness,
          workflowId: targetId,
          prefixOutput: `已基于 workflow ${parentWorkflowId} 创建 ${requestedNodeRunKind} 节点任务。`,
        })
      }

      let pendingHumanActionWorkflowId: string | undefined
      for (const wf of activeWorkflows) {
        const ha = await harness.humanActionStore.getCurrent(wf.workflowId)
        if (ha && (ha.status === "pending" || ha.status === "presented")) {
          pendingHumanActionWorkflowId = wf.workflowId
          break
        }
      }

      const primaryWorkflow = activeWorkflows[0] ?? null

      const routerInput: WorkflowRouterInput = {
        rawPayload: payload ?? "",
        prompt: openRequest.prompt,
        requestedWorkflowId: workflowId,
        activeWorkflows,
        primaryWorkflow,
        hasPendingHumanAction: !!pendingHumanActionWorkflowId,
        ...(pendingHumanActionWorkflowId ? { pendingHumanActionWorkflowId } : {}),
      }

      const routingDecision: WorkflowRoutingDecision = openRequest.mode
        ? (() => {
            const mostRecentActive = getMostRecentActiveWorkflow(workflows)
            if (mostRecentActive) {
              // Active workflow exists — ask user to choose
              return {
                action: "confirm" as const,
                reason: `preset-requested-but-active-workflow-exists:${mostRecentActive.workflowId}`,
                targetWorkflowId: mostRecentActive.workflowId,
              }
            }
            return {
              action: "new" as const,
              reason: `preset-requested:${openRequest.mode}`,
              targetWorkflowId: resolvePresetWorkflowTargetId(workflowId),
            }
          })()
        : classifyWorkflowIntent(routerInput)

      const hasAnyWorkflow = activeWorkflows.length > 0 || !!pendingHumanActionWorkflowId

      switch (routingDecision.action) {
        case "continue": {
          if (!hasAnyWorkflow) {
            return {
              ok: true,
              output: formatRoutingOutput({ action: "confirm", reason: "continue-requested-but-no-workflow-to-continue" }),
              events: [],
              workflowId,
            }
          }
          const targetId = routingDecision.targetWorkflowId ?? workflowId
          if (foregroundSessionId) {
            await harness.stateStore.updateRuntime(targetId, {
              preferredForegroundSessionId: foregroundSessionId,
            })
          }
          await harness.attachService.attach(targetId)
          return buildWorkflowStatusResult({
            harness,
            workflowId: targetId,
            prefixOutput: formatRoutingOutput(routingDecision),
          })
        }

        case "fork":
          if (!hasAnyWorkflow) {
            return {
              ok: true,
              output: formatRoutingOutput({ action: "confirm", reason: "fork-requested-but-no-parent-workflow" }),
              events: [],
              workflowId,
            }
          }
        // fall through to "new" handler
        case "new": {
          const targetId = routingDecision.targetWorkflowId ?? workflowId
          await initializeWorkflow({
            workflowId: targetId,
            stateStore: harness.stateStore,
            artifactEvaluator: harness.artifactEvaluator,
            userRequest: openRequest.userRequest,
            ...(openRequest.mode ? { presetMode: openRequest.mode } : {}),
            ...(openRequest.startAt ? { startAt: openRequest.startAt } : {}),
          })
          if (foregroundSessionId) {
            await harness.stateStore.updateRuntime(targetId, {
              preferredForegroundSessionId: foregroundSessionId,
            })
          }
          // Cleanup old completed workflows
          await archiveCompletedWorkflows(harness, ARCHIVE_KEEP_COUNT)
          await harness.attachService.attach(targetId)
          return buildWorkflowStatusResult({
            harness,
            workflowId: targetId,
            prefixOutput: formatRoutingOutput(routingDecision),
          })
        }

        case "confirm": {
          if (routingDecision.reason.startsWith("preset-requested-but-active-workflow-exists:")) {
            const activeId = routingDecision.targetWorkflowId!
            const activeWf = workflows.find((wf) => wf.workflowId === activeId)
            const phase = activeWf?.phase ?? "unknown"
            const status = activeWf?.status ?? "unknown"

            await savePendingClarification(harness, workflowId, {
              rawPayload: payload ?? "",
              prompt: `检测到未完成的工作流 ${activeId} (phase: ${phase}, status: ${status})，你想继续还是新开？`,
              options: ["1. 继续/恢复当前工作流", "2. 新建一个全新的工作流"],
              sourceWorkflowId: activeId,
              ...(openRequest.mode ? { mode: openRequest.mode } : {}),
            })

            return {
              ok: true,
              output: [
                `检测到未完成的工作流 ${activeId} (phase: ${phase}, status: ${status})，你想继续还是新开？`,
                "1. 继续/恢复当前工作流",
                "2. 新建一个全新的工作流",
              ].join("\n"),
              events: [],
              workflowId: activeId,
            }
          }
          return {
            ok: true,
            output: formatRoutingOutput(routingDecision),
            events: [],
            workflowId,
          }
        }
      }
    } else if (command === "workflow-attach") {
      const clarification = await renderClarificationIfAny(harness, workflowId)
      if (clarification) {
        return clarification
      }
      if (foregroundSessionId) {
        await harness.stateStore.updateRuntime(workflowId, {
          preferredForegroundSessionId: foregroundSessionId,
        })
      }
      await harness.attachService.attach(workflowId)
    } else if (command === "workflow-answer") {
      let answers: Record<string, string> | null = null
      if (payload) {
        try {
          const parsed = JSON.parse(payload) as unknown
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            answers = parsed as Record<string, string>
          }
        } catch {
          answers = null
        }
      }

      if (answers) {
        const lifecycleDecision = answers.lifecycle_decision ?? answers.answer
        if (lifecycleDecision === "resume" || lifecycleDecision === "1") {
          // User chose to resume active workflow
          const pending = await readPendingClarification(harness, workflowId)
          await clearPendingClarification(harness, workflowId)
          const sourceWorkflowId = pending?.sourceWorkflowId ?? workflowId
          if (sourceWorkflowId) {
            const sourceWorkflow = await harness.stateStore.getWorkflow(sourceWorkflowId)
            if (sourceWorkflow && isActiveWorkflow(sourceWorkflow)) {
              if (foregroundSessionId) {
                await harness.stateStore.updateRuntime(sourceWorkflowId, {
                  preferredForegroundSessionId: foregroundSessionId,
                })
              }
              await harness.attachService.attach(sourceWorkflowId)
              return buildWorkflowStatusResult({
                harness,
                workflowId: sourceWorkflowId,
                clarificationWorkflowId: workflowId,
                prefixOutput: "已继续当前任务。",
              })
            }
          }
          // Fallback: no active workflow found, treat as normal answer
          await harness.humanActionService.answer(workflowId, answers)
        } else if (lifecycleDecision === "new" || lifecycleDecision === "2") {
          // User chose to start fresh — keep old workflow untouched and create new
          const pending = await readPendingClarification(harness, workflowId)
          await clearPendingClarification(harness, workflowId)
          const originalMode = pending?.mode
          let originalPrompt: string | undefined
          if (pending?.rawPayload) {
            try {
              const parsed = JSON.parse(pending.rawPayload) as { prompt?: string }
              originalPrompt = parsed.prompt
            } catch {
              originalPrompt = undefined
            }
          }
          const targetId = resolvePresetWorkflowTargetId(workflowId)
          await initializeWorkflow({
            workflowId: targetId,
            stateStore: harness.stateStore,
            artifactEvaluator: harness.artifactEvaluator,
            userRequest: originalPrompt ?? "",
            ...(originalMode ? { presetMode: originalMode as any } : {}),
          })
          if (foregroundSessionId) {
            await harness.stateStore.updateRuntime(targetId, {
              preferredForegroundSessionId: foregroundSessionId,
            })
          }
          // Cleanup old completed and archived workflows
          await archiveCompletedWorkflows(harness, ARCHIVE_KEEP_COUNT)
          await harness.attachService.attach(targetId)
          return buildWorkflowStatusResult({
            harness,
            workflowId: targetId,
            clarificationWorkflowId: workflowId,
            prefixOutput: "已创建新的独立任务。",
          })
        } else {
          await harness.humanActionService.answer(workflowId, answers)
        }
      } else {
        const pending = await readPendingClarification(harness, workflowId)
        if (!pending) {
          throw new Error("workflow_answer received non-JSON payload but no pending clarification was found")
        }
        const intentPrompt = buildIntentPromptFromChoice(payload ?? "", pending.rawPayload)
        await clearPendingClarification(harness, workflowId)
        await initializeWorkflow({
          workflowId,
          stateStore: harness.stateStore,
          artifactEvaluator: harness.artifactEvaluator,
          userRequest: intentPrompt,
        })
        if (foregroundSessionId) {
          await harness.stateStore.updateRuntime(workflowId, {
            preferredForegroundSessionId: foregroundSessionId,
          })
        }
        await harness.attachService.attach(workflowId)
      }
    } else if (command === "workflow-approve") {
      if (foregroundSessionId) {
        await harness.stateStore.updateRuntime(workflowId, {
          preferredForegroundSessionId: foregroundSessionId,
        })
      }
      await harness.humanActionService.approve(workflowId)
      await harness.attachService.attach(workflowId)
    } else if (command === "workflow-resume") {
      let resumeDecision: "fix" | "accept" | undefined
      if (payload) {
        try {
          const parsed = JSON.parse(payload) as { decision?: unknown }
          if (parsed.decision === "fix" || parsed.decision === "accept") {
            resumeDecision = parsed.decision
          }
        } catch {
          resumeDecision = undefined
        }
      }
      if (foregroundSessionId) {
        await harness.stateStore.updateRuntime(workflowId, {
          preferredForegroundSessionId: foregroundSessionId,
        })
      }
      await harness.humanActionService.resume(workflowId, resumeDecision)
      await harness.attachService.attach(workflowId)
    } else if (command === "workflow-resync") {
      if (foregroundSessionId) {
        await harness.stateStore.updateRuntime(workflowId, {
          preferredForegroundSessionId: foregroundSessionId,
        })
      }
      await harness.humanActionService.resync(workflowId)
      await harness.attachService.attach(workflowId)
    } else if (command === "workflow-back") {
      await harness.sessionActivityMonitor.stop(workflowId)
      const events = await harness.eventStore.list(workflowId)
      return {
        ok: true,
        output: `Returned from workflow channel for ${workflowId}. Your workflow continues and can be re-attached later.`,
        events,
        workflowId,
      }
    }

    return buildWorkflowStatusResult({
      harness,
      workflowId,
    })
  }
}
