import type { HumanActionRecord } from "../../../core/src/human-actions/human-action-record"
import { normalizeWorkflowRunKind, type WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../../../core/src/state/workflow-state"

const divider = "=".repeat(64)
const fullPhaseOrder = ["spec_refinement", "plan", "develop", "review", "test", "done"] as const
const reviewHeavyPhaseOrder = ["review", "done"] as const
const developPhaseOrder = ["develop", "done"] as const
const verifyPhaseOrder = ["test", "done"] as const
type ProgressPhase = typeof fullPhaseOrder[number]

function describeRunKind(runtime: WorkflowRuntimeState | null): string {
  const runKind = normalizeWorkflowRunKind(runtime?.runKind)
  if (!runKind || runKind === "full") {
    return "full workflow"
  }
  return `node run (${runKind})`
}

function renderProgressTodos(workflow: WorkflowState, runtime: WorkflowRuntimeState | null): string[] {
  const runKind = normalizeWorkflowRunKind(runtime?.runKind)
  const phaseOrder: readonly ProgressPhase[] = runKind === "review-heavy"
    ? reviewHeavyPhaseOrder
    : runKind === "develop"
      ? developPhaseOrder
      : runKind === "verify"
        ? verifyPhaseOrder
      : fullPhaseOrder
  const currentIndex = phaseOrder.indexOf(workflow.phase as ProgressPhase)
  if (currentIndex === -1) {
    return []
  }

  const labelByPhase: Record<ProgressPhase, string> = {
    spec_refinement: "Refinement",
    plan: "Plan",
    develop: "Develop",
    review: "Review",
    test: "Test",
    done: "Done",
  }

  return phaseOrder.map((phase, index) => {
    const marker = workflow.phase === "blocked"
      ? index < currentIndex ? "[x]" : "[-]"
      : index < currentIndex
        ? "[x]"
        : index === currentIndex
          ? "[~]"
          : "[ ]"
    return `${marker} ${labelByPhase[phase]}`
  })
}

function renderClarificationBlock(clarification: { prompt: string; options: string[] }): string[] {
  const lines = ["Clarification required:", clarification.prompt]
  if (clarification.options.length > 0) {
    lines.push(...clarification.options)
  }
  return lines
}

function actionLabel(actionType: HumanActionRecord["action"]["type"]): string {
  switch (actionType) {
    case "need_answers":
      return "Answer Required"
    case "need_approval":
      return "Approval Required"
    case "blocked":
      return "Manual Decision Required"
    case "done":
      return "Done"
  }
}

function exactAction(record: HumanActionRecord): string {
  if (record.action.type === "need_answers") {
    const payload = recommendedPayload(record) ?? '{"your-question-id":"your answer"}'
    return `Run: bun run src/cli.ts answer ${record.workflowId} '${payload}'`
  }
  if (record.action.type === "need_approval") {
    return `Run: bun run src/cli.ts approve ${record.workflowId}`
  }
  if (record.action.type === "blocked") {
    if (record.action.allowedDecisions?.includes("fix") || record.action.allowedDecisions?.includes("accept")) {
      return `Run: bun run src/cli.ts resume ${record.workflowId} fix or bun run src/cli.ts resync ${record.workflowId}`
    }
    return `Run: bun run src/cli.ts resume ${record.workflowId} or bun run src/cli.ts resync ${record.workflowId}`
  }
  return "No action required"
}

function recommendedActionLabel(record: HumanActionRecord): string {
  if (record.action.type === "need_answers") {
    return "workflow_answer"
  }
  if (record.action.type === "need_approval") {
    return "confirm approval"
  }
  if (record.action.type === "blocked") {
    return "workflow_resume or workflow_resync"
  }
  return "workflow_status"
}

function recommendedPayload(record: HumanActionRecord): string | null {
  if (record.action.type === "blocked") {
    if (record.action.allowedDecisions?.includes("fix") || record.action.allowedDecisions?.includes("accept")) {
      return "fix"
    }
    return null
  }

  if (record.action.type !== "need_answers") {
    return null
  }

  const payload = Object.fromEntries(
    (record.action.questions ?? []).map((question) => [question.id, question.suggestedAnswer ?? "your answer"]),
  )
  return JSON.stringify(payload)
}

function blockedWorkflowRecommendation(workflow: WorkflowState, runtime: WorkflowRuntimeState | null): {
  tool: string
  payload?: string
  exactAction: string
  channelState: string
} {
  const blockedFromPhase = runtime?.blockedFromPhase
  if (workflow.phase === "blocked" && (blockedFromPhase === "review" || blockedFromPhase === "test")) {
    const apGoalBudgetExhausted = runtime?.presetMode === "ap-goal"
      && ((blockedFromPhase === "review" && workflow.blockReason === "Exceeded maxIterations while fixing review issues")
        || (blockedFromPhase === "test" && workflow.blockReason === "Exceeded maxIterations while fixing test issues"))
    return {
      tool: "workflow_resume or workflow_resync",
      payload: "fix",
      exactAction: `Run workflow_resume for ${workflow.workflowId} with payload fix to return to develop, or workflow_resync if you specifically want to rerun ${blockedFromPhase} against out-of-band edits.`,
      channelState: apGoalBudgetExhausted
        ? "blocked ap-goal workflow after automatic repair budget exhaustion; waiting for explicit resume or resync"
        : "blocked review/test workflow waiting for manual fix/accept decision or explicit resync",
    }
  }

  return {
    tool: "workflow_status",
    exactAction: `Re-run workflow_status for ${workflow.workflowId} to inspect the blocked state before choosing the next action.`,
    channelState: "waiting for external progress or next attach",
  }
}

function renderQuestions(record: HumanActionRecord): string[] {
  const questions = record.action.questions ?? []
  if (questions.length === 0) {
    return []
  }

  return [
    "Questions:",
    ...questions.map((question, index) => {
      const suggested = question.suggestedAnswer ? ` | suggested: ${question.suggestedAnswer}` : ""
      return `${index + 1}. [${question.priority}] ${question.text}${suggested}`
    }),
  ]
}

export function renderHumanActionBlock(args: {
  workflow: WorkflowState
  runtime: WorkflowRuntimeState | null
  humanAction: HumanActionRecord | null
  clarification?: { prompt: string; options: string[] } | null
  phaseDetails?: string[]
}): string {
  const { workflow, runtime, humanAction, clarification, phaseDetails = [] } = args

  const lines = [
    divider,
    `Workflow: ${workflow.workflowId}`,
    `Phase: ${workflow.phase}`,
    `Status: ${workflow.status}`,
    `Iteration: ${workflow.iteration}/${workflow.maxIterations}`,
  ]

  if (workflow.blockReason) {
    lines.push(`Block reason: ${workflow.blockReason}`)
  }

  if (runtime?.recoveryState === "recovering") {
    lines.push("Recovery: in progress")
  }
  if (runtime?.startMode === "direct-develop") {
    lines.push("Start mode: direct-develop")
  }
  if (runtime?.presetMode) {
    lines.push(`Preset mode: ${runtime.presetMode}`)
  }
  const normalizedRunKind = normalizeWorkflowRunKind(runtime?.runKind)
  if (normalizedRunKind) {
    lines.push(`Run kind: ${normalizedRunKind}`)
  }
  lines.push(`Workflow kind: ${describeRunKind(runtime)}`)
  if (runtime?.parentWorkflowId) {
    lines.push(`Parent workflow: ${runtime.parentWorkflowId}`)
  }
  if (runtime?.sourceWorkflowId && runtime.sourceWorkflowId !== runtime.parentWorkflowId) {
    lines.push(`Source workflow: ${runtime.sourceWorkflowId}`)
  }
  if ((runtime?.skippedPhases?.length ?? 0) > 0) {
    lines.push(`Skipped phases: ${runtime?.skippedPhases?.join(", ")}`)
  }
  if (runtime?.outOfBandEditsDetected) {
    lines.push("Resync state: out-of-band edits detected")
  }
  if (runtime?.resyncedFromPhase) {
    lines.push(`Last resync phase: ${runtime.resyncedFromPhase}`)
  }

  if (clarification) {
    lines.push("")
    lines.push(...renderClarificationBlock(clarification))
    lines.push(divider)
    return lines.join("\n")
  }

  const progressTodos = renderProgressTodos(workflow, runtime)
  if (progressTodos.length > 0) {
    lines.push("")
    lines.push("Progress:")
    lines.push(...progressTodos)
  }

  if (phaseDetails.length > 0) {
    lines.push("")
    lines.push("Details:")
    lines.push(...phaseDetails)
  }

  if (!humanAction || humanAction.status === "consumed") {
    if (workflow.status === "blocked") {
      const blockedRecommendation = blockedWorkflowRecommendation(workflow, runtime)
      lines.push("Human action: none")
      lines.push(`Recommended tool: ${blockedRecommendation.tool}`)
      if (blockedRecommendation.payload) {
        lines.push(`Recommended payload: ${blockedRecommendation.payload}`)
      }
      lines.push(`Exact action: ${blockedRecommendation.exactAction}`)
      lines.push(`Channel state: ${blockedRecommendation.channelState}`)
      lines.push(divider)
      return lines.join("\n")
    }

    lines.push("Human action: none")
    lines.push(`Recommended tool: ${workflow.status === "completed" ? "workflow_back" : workflow.status === "in_progress" ? "workflow_attach" : "workflow_status"}`)
    lines.push(workflow.status === "completed"
      ? "Channel state: workflow completed"
      : workflow.status === "in_progress"
        ? "Channel state: workflow is still running or waiting for the next attach-driven continuation"
        : "Channel state: waiting for external progress or next attach")
    if (workflow.status === "completed") {
      lines.push("Suggestion: if you are done with this workflow, you can end it before opening a new one.")
      lines.push(`Exact action: Run workflow_back for ${workflow.workflowId} when you want to close this workflow.`)
    }
    if (workflow.status === "in_progress") {
      lines.push(`Exact action: Re-run workflow_attach for ${workflow.workflowId} to continue the workflow loop.`)
      lines.push("Agent hint: if you are the workflow main agent, do not stop here — continue with workflow_attach until a human action or terminal state appears.")
    }
    lines.push(divider)
    return lines.join("\n")
  }

  lines.push("")
  lines.push(`Human action: ${actionLabel(humanAction.action.type)}`)
  lines.push(`Reason: ${humanAction.action.reason}`)
  if (humanAction.action.summary) {
    lines.push(`Summary: ${humanAction.action.summary}`)
  }
  if (humanAction.status) {
    lines.push(`Action status: ${humanAction.status}`)
  }

  const questionLines = renderQuestions(humanAction)
  if (questionLines.length > 0) {
    lines.push("")
    lines.push(...questionLines)
  }

  lines.push("")
  lines.push(`${humanAction.action.type === "need_approval" ? "Recommended user action" : "Recommended tool"}: ${recommendedActionLabel(humanAction)}`)
  if (humanAction.action.type === "need_approval") {
    lines.push("Explicit user confirmation required before approval.")
  }
  const payload = recommendedPayload(humanAction)
  if (payload) {
    lines.push(`Recommended payload: ${payload}`)
  }
  lines.push(`Exact action: ${exactAction(humanAction)}`)
  lines.push(divider)
  return lines.join("\n")
}
