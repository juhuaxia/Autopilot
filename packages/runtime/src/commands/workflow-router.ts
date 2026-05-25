/**
 * Workflow Auto-Router
 *
 * Classifies user input into one of 4 routing actions when a workflow-open
 * request arrives:
 *
 *   1. "continue"  — continue current workflow (continuation of same delivery round)
 *   2. "fork"      — create follow-up workflow from parent (same topic, new round)
 *   3. "new"       — create brand-new independent workflow
 *   4. "confirm"   — ambiguous; ask user before deciding
 *
 * This replaces / extends the naive continuation detection in
 * workflow-open-request.ts with a richer, context-aware classifier.
 */

import type { WorkflowState } from "../../../core/src/state/workflow-state"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowRoutingAction = "continue" | "fork" | "new" | "confirm"

export interface WorkflowRoutingDecision {
  /** Which action to take */
  action: WorkflowRoutingAction
  /** Human-readable reason (for logging / debugging, NOT shown to user) */
  reason: string
  /** When action is "continue" or "fork", which workflowId to target */
  targetWorkflowId?: string
  /** When action is "fork", the parent workflowId */
  parentWorkflowId?: string
}

export interface WorkflowRouterInput {
  /** Raw user payload text */
  rawPayload: string
  /** Trimmed & normalized user prompt */
  prompt: string
  /**
   * The workflowId that was passed to the workflow-open command.
   * May be "default" or any other ID the agent chose.
   */
  requestedWorkflowId: string
  /** All non-completed, non-blocked workflows currently on disk */
  activeWorkflows: WorkflowState[]
  /**
   * If there is exactly one "primary" workflow (most recent or most relevant),
   * it goes here. Null if none or ambiguous.
   */
  primaryWorkflow: WorkflowState | null
  /** Whether any active workflow has a pending human action */
  hasPendingHumanAction: boolean
  /** The workflowId that has the pending human action (if any) */
  pendingHumanActionWorkflowId?: string
}

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

/**
 * Level 1: Hard continuation signals.
 * These ALWAYS mean "continue current workflow" — no ambiguity.
 */
const HARD_CONTINUATION_PATTERNS = [
  // Exact short commands
  "继续",
  "继续下一步",
  "继续做",
  "接着做",
  "往下走",
  // Approval / answer signals
  "批准",
  "同意",
  "通过",
  "确认",
  // Explicit phase references
]

/**
 * Negation prefixes that invalidate continuation patterns.
 * e.g. "不要继续" should NOT be treated as continuation.
 */
const NEGATION_PREFIXES = [
  "不要",
  "先不要",
  "别",
  "先别",
  "不",
  "不用",
  "无需",
]

/**
 * Phrases that indicate the user is responding to a specific phase artifact
 * or human action. These are strong continuation signals.
 */
const PHASE_CONTINUATION_PATTERNS = [
  "修 review",
  "修复 review",
  "改 review",
  "review 问题",
  "把 test",
  "跑 test",
  "执行测试",
  "补测试",
  "回答问题",
  "我的答案是",
  "问题.*的答案是",
  "选第?\\d",
  "选项\\s*\\d",
  "方案\\s*[abcdABCD]",
  "按方案",
  "选择方案",
]

/**
 * Level 3: Weak / ambiguous signals.
 * These alone are insufficient for automatic decision.
 */
const AMBIGUOUS_PATTERNS = [
  "再改一下",
  "还有个问题",
  "顺便处理",
  "顺便做",
  "再弄一下",
  "再处理下",
  "还有一事",
  "另外.*问题",
  "还有一个",
  "再调整",
  "稍微改",
  "小改",
  "微调",
]

/**
 * Signals that suggest a NEW independent requirement.
 */
const NEW_REQUIREMENT_PATTERNS = [
  "新需求",
  "另一个需求",
  "新功能",
  "新任务",
  "另外帮我",
  "再做.*功能",
  "新增.*功能",
  "加一个.*功能",
  "现在.*处理",
  "开始.*新",
  "启动.*新",
  "创建.*新",
]

/**
 * Signals that suggest a FOLLOW-UP iteration (same topic, new delivery round).
 * These typically appear when the current workflow is already done/near-done.
 */
const FOLLOWUP_ITERATION_PATTERNS = [
  "再补",
  "再优化",
  "再增强",
  "再加",
  "扩展.*能力",
  "补充.*功能",
  "迭代",
  "第二轮",
  "下一轮",
  "在此基础上",
  "在这个.*基础上",
  "接着.*增强",
  "继续.*完善",
  "继续.*优化",
  "继续.*扩展",
  "再做一个",
  "再来一轮",
  "follow.?up",
  "再做.*轮",
  "再.*增强",
  "再.*优化",
  "再.*补",
  "再.*扩展",
  "再.*迭代",
]

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

function isNegated(text: string): boolean {
  const lower = text.toLowerCase().trim()
  return NEGATION_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

function matchesAny(text: string, patterns: readonly string[]): boolean {
  const lower = text.toLowerCase().trim()
  return patterns.some((pattern) => new RegExp(pattern, "i").test(lower))
}

function isTerminalPhase(workflow: WorkflowState | null | undefined): boolean {
  if (!workflow) return false
  return workflow.phase === "done" || workflow.status === "completed"
}

function isInProgress(workflow: WorkflowState | null | undefined): boolean {
  if (!workflow) return false
  return !isTerminalPhase(workflow) && workflow.status !== "blocked"
}

/**
 * Generate a derived workflow ID for fork/new workflows.
 * Uses the base name + a short suffix to keep it identifiable but unique.
 */
export function generateDerivedWorkflowId(baseId: string, action: "fork" | "new"): string {
  const timestamp = Date.now().toString(36)
  const suffix = action === "fork" ? `-followup-${timestamp}` : `-${timestamp}`
  if (baseId.endsWith(suffix) || (action === "fork" && baseId.includes("-followup-"))) {
    return baseId
  }
  return `${baseId}${suffix}`
}

/**
 * Main classification function.
 *
 * Given the user's input and current workflow context, decides which
 * routing action to take.
 */
export function classifyWorkflowIntent(input: WorkflowRouterInput): WorkflowRoutingDecision {
  const { rawPayload, prompt, requestedWorkflowId, activeWorkflows, primaryWorkflow, hasPendingHumanAction, pendingHumanActionWorkflowId } = input

  const trimmedPayload = rawPayload.trim()
  const hasNoWorkflowsAtAll = activeWorkflows.length === 0

  // --- Guard: empty payload ---
  if (!trimmedPayload || trimmedPayload.length > 2000) {
    return { action: "confirm", reason: "payload-empty-or-too-long" }
  }

  // --- Guard: negated ---
  if (isNegated(trimmedPayload)) {
    // Negation + continuation pattern → treat as ambiguous (could be "don't continue, do X instead")
    if (matchesAny(trimmedPayload, [...HARD_CONTINUATION_PATTERNS, ...PHASE_CONTINUATION_PATTERNS])) {
      return { action: "confirm", reason: "negated-continuation-pattern" }
    }
    // Negation without clear pattern → fall through to normal classification
  }

  // ===================================================================
  // Level 1: Hard continuation signals
  // ===================================================================

  // 1a. Responding to a pending human action → MUST continue that workflow
  if (hasPendingHumanAction && pendingHumanActionWorkflowId) {
    // Check if the response looks like an actual answer/approval
    const looksLikeResponse =
      matchesAny(trimmedPayload, ["批准", "同意", "通过", "确认"]) ||
      /^\s*\{/.test(trimmedPayload) ||  // JSON answer
      (trimmedPayload.toLowerCase().trim() === "ok" && trimmedPayload.length < 10) ||  // standalone "ok"
      trimmedPayload.length < 100 && !matchesAny(trimmedPayload, NEW_REQUIREMENT_PATTERNS)

    if (looksLikeResponse) {
      return {
        action: "continue",
        reason: "responding-to-pending-human-action",
        targetWorkflowId: pendingHumanActionWorkflowId,
      }
    }
  }

  // 1b. Hard continuation patterns while workflow is in progress
  if (isInProgress(primaryWorkflow) && matchesAny(trimmedPayload, HARD_CONTINUATION_PATTERNS)) {
    if (!matchesAny(trimmedPayload, NEW_REQUIREMENT_PATTERNS) && primaryWorkflow) {
      return {
        action: "continue",
        reason: "hard-continuation-pattern-with-active-workflow",
        targetWorkflowId: primaryWorkflow.workflowId,
      }
    }
  }

  // 1c. Phase-specific continuation (mentioning review/test/plan issues)
  if (isInProgress(primaryWorkflow) && matchesAny(trimmedPayload, PHASE_CONTINUATION_PATTERNS) && primaryWorkflow) {
    return {
      action: "continue",
      reason: "phase-specific-continuation-with-active-workflow",
      targetWorkflowId: primaryWorkflow.workflowId,
    }
  }

  // 1d. Continuation signal without any workflow to continue → confirm
  if (hasNoWorkflowsAtAll && matchesAny(trimmedPayload, [...HARD_CONTINUATION_PATTERNS, ...PHASE_CONTINUATION_PATTERNS])) {
    return { action: "confirm", reason: "continuation-signal-but-no-workflow-exists" }
  }

  // ===================================================================
  // Level 2: Strong semantic signals
  // ===================================================================

  // 2a. New requirement patterns → create new workflow
  if (matchesAny(trimmedPayload, NEW_REQUIREMENT_PATTERNS)) {
    const newId = generateDerivedWorkflowId(requestedWorkflowId, "new")
    return {
      action: "new",
      reason: "new-requirement-pattern-detected",
      targetWorkflowId: newId,
    }
  }

  // 2b. Follow-up iteration patterns
  if (matchesAny(trimmedPayload, FOLLOWUP_ITERATION_PATTERNS)) {
    // If primary workflow is done/near-done → fork
    if (isTerminalPhase(primaryWorkflow) && primaryWorkflow) {
      const forkId = generateDerivedWorkflowId(
        primaryWorkflow.workflowId,
        "fork",
      )
      return {
        action: "fork",
        reason: "followup-iteration-on-completed-workflow",
        targetWorkflowId: forkId,
        parentWorkflowId: primaryWorkflow?.workflowId,
      }
    }

    // If primary workflow is still in progress → could be either continue or confirm
    // Conservative: treat as continue (user likely wants to add to current work)
    if (isInProgress(primaryWorkflow) && primaryWorkflow) {
      return {
        action: "continue",
        reason: "followup-pattern-but-workflow-still-in-progress",
        targetWorkflowId: primaryWorkflow.workflowId,
      }
    }

    // No primary workflow at all → treat as new
    const newId = generateDerivedWorkflowId(requestedWorkflowId, "new")
    return {
      action: "new",
      reason: "followup-pattern-no-active-workflow",
      targetWorkflowId: newId,
    }
  }

  // ===================================================================
  // Level 3: Ambiguous signals → request confirmation
  // ===================================================================

  if (matchesAny(trimmedPayload, AMBIGUOUS_PATTERNS)) {
    return { action: "confirm", reason: "ambiguous-pattern-detected" }
  }

  // ===================================================================
  // Default: context-based heuristic
  // ===================================================================

  // If there are only completed workflows (no in-progress) and no strong signal,
  // disambiguate rather than auto-creating
  const hasOnlyCompletedWorkflows = activeWorkflows.length > 0
    && !activeWorkflows.some((wf) => isInProgress(wf))

  if (hasOnlyCompletedWorkflows) {
    return { action: "confirm", reason: "only-completed-workflows-needs-disambiguation" }
  }

  // If there's an active in-progress workflow and no strong signal either way,
  // default to continuing it (most common case for natural conversation flow)
  if (isInProgress(primaryWorkflow) && primaryWorkflow) {
    return {
      action: "continue",
      reason: "default-continue-active-workflow",
      targetWorkflowId: primaryWorkflow.workflowId,
    }
  }

  // If the only workflow is completed and user sends something non-trivial,
  // it's likely a new requirement or follow-up → confirm
  if (isTerminalPhase(primaryWorkflow) && activeWorkflows.length > 0) {
    return { action: "confirm", reason: "completed-workflow-needs-disambiguation" }
  }

  // No workflow context at all → this is a fresh start, treat as new
  // (use caller's requestedWorkflowId; don't generate a synthetic ID)
  return {
    action: "new",
    reason: "no-existing-workflow-context",
    targetWorkflowId: requestedWorkflowId,
  }
}

export function formatRoutingOutput(decision: WorkflowRoutingDecision): string {
  switch (decision.action) {
    case "continue":
      return "已继续当前任务。"
    case "fork":
      return [
        "已为当前主题创建后续任务。",
        "",
        `原任务：${decision.parentWorkflowId ?? "unknown"}`,
        `后续任务：${decision.targetWorkflowId ?? "unknown"}`,
      ].join("\n")
    case "new":
      return "已创建新的独立任务。"
    case "confirm":
      return [
        "这可能是继续当前任务，也可能是新任务。",
        "",
        "请确认你的意图：",
        "1. 继续当前任务",
        "2. 创建新的独立任务",
        "3. 从当前任务派生后续任务",
      ].join("\n")
  }
}
