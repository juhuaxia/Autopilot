import { initializeWorkflow } from "../bootstrap/initialize-workflow"
import { renderHumanActionBlock } from "../presentation/human-action-renderer"
import { buildWorkflowOpenRequest } from "./workflow-open-request"
import type { WorkflowCommandResult, WorkflowCommandRunner } from "./workflow-command-runner"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { WorkflowEventRecord } from "../events/workflow-event-store"
import type { WorkflowState } from "../../../core/src/state/workflow-state"

function extractSection(content: string, heading: string): string {
  const start = content.indexOf(heading)
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
  events: WorkflowEventRecord[]
}): Promise<string[]> {
  const { harness, workflow, events } = args
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
  }

  if (storedSession?.lastDispatchMode) {
    lines.push(`Dispatch mode: ${storedSession.lastDispatchMode}`)
  }
  if (storedSession?.lastStatusBeforeDispatch) {
    lines.push(`Status before dispatch: ${storedSession.lastStatusBeforeDispatch}`)
  }

  if (evaluation.missing.length > 0) {
    lines.push(`Missing signals: ${evaluation.missing.join(" | ")}`)
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

    if (command === "workflow-open") {
      const openRequest = await buildWorkflowOpenRequest(payload, process.cwd())
      if (openRequest.needsClarification) {
        await savePendingClarification(harness, workflowId, {
          rawPayload: payload ?? "",
          prompt: openRequest.clarificationQuestion ?? "我需要先确认你的意图。",
          options: openRequest.clarificationOptions ?? [],
        })
        const outputLines = [openRequest.clarificationQuestion ?? "我需要先确认你的意图。"]
        if (openRequest.clarificationOptions && openRequest.clarificationOptions.length > 0) {
          outputLines.push(...openRequest.clarificationOptions)
        }
        return {
          ok: true,
          output: outputLines.join("\n"),
          events: [],
        }
      }
      await initializeWorkflow({
        workflowId,
        stateStore: harness.stateStore,
        artifactEvaluator: harness.artifactEvaluator,
        userRequest: openRequest.userRequest,
      })
      if (foregroundSessionId) {
        await harness.stateStore.updateRuntime(workflowId, {
          preferredForegroundSessionId: foregroundSessionId,
        })
      }
      await harness.attachService.attach(workflowId)
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
        await harness.humanActionService.answer(workflowId, answers)
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
      if (foregroundSessionId) {
        await harness.stateStore.updateRuntime(workflowId, {
          preferredForegroundSessionId: foregroundSessionId,
        })
      }
      await harness.humanActionService.resume(workflowId)
      await harness.attachService.attach(workflowId)
    } else if (command === "workflow-back") {
      await harness.sessionActivityMonitor.stop(workflowId)
      const events = await harness.eventStore.list(workflowId)
      return {
        ok: true,
        output: `Returned from workflow channel for ${workflowId}. Your workflow continues and can be re-attached later.`,
        events,
      }
    }

    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    const events = await harness.eventStore.list(workflowId)
    const clarification = await readPendingClarification(harness, workflowId)
    if (!workflow) {
      if (clarification) {
        return {
          ok: true,
          output: [clarification.prompt, ...clarification.options].join("\n"),
          events: [],
        }
      }
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const enhancementLines = await buildStatusEnhancements({
      harness,
      workflow,
      events,
    })

    return {
      ok: true,
      output: [
        renderHumanActionBlock({
          workflow,
          runtime,
          humanAction,
          clarification: clarification
            ? { prompt: clarification.prompt, options: clarification.options }
            : null,
          phaseDetails: enhancementLines,
        }),
      ].join("\n"),
      events,
    }
  }
}
