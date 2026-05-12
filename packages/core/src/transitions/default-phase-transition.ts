import type { HumanAction } from "../human-actions/human-action"
import type { Phase } from "../state/phase"
import type { PhaseTransition, PhaseTransitionInput } from "./phase-transition"
import type { TransitionAction } from "./transition-action"

const MAX_SPEC_REFINEMENT_SELF_REPAIR_ATTEMPTS = 1
const MAX_CONSECUTIVE_FAILURES = 3
const MAX_REVIEW_OR_TEST_UNKNOWN_DISPATCH_ATTEMPTS = 3
const MAX_REPEATED_ARTIFACT_SIGNAL_DISPATCH_ATTEMPTS = 3

function getPhaseDispatchAttempts(runtime: PhaseTransitionInput["runtime"], phase: Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">): number {
  return runtime.phaseDispatchAttempts?.[phase] ?? 0
}

function shouldEscalateUnknownConclusion(input: PhaseTransitionInput, phase: "review" | "test"): TransitionAction | null {
  if (getPhaseDispatchAttempts(input.runtime, phase) < MAX_REVIEW_OR_TEST_UNKNOWN_DISPATCH_ATTEMPTS) {
    return null
  }

  const action: HumanAction = {
    type: "blocked",
    workflowId: input.workflow.workflowId,
    phase,
    reason: `${phase} exceeded dispatch retry budget and needs human decision`,
    required: true,
    createdAt: new Date().toISOString(),
    ...(input.artifact.summary ? { summary: input.artifact.summary } : {}),
  }
  return { type: "wait_human", action }
}

function buildArtifactSignalSignature(input: PhaseTransitionInput, phase: Extract<Phase, "develop" | "review" | "test">): string | null {
  const signals = [
    phase,
    ...input.artifact.missing.map((item) => `missing:${item}`),
    ...(input.artifact.warnings ?? []).map((item) => `warning:${item}`),
    `summary:${input.artifact.summary ?? ""}`,
  ]
  return signals.length > 1 ? signals.join("|") : null
}

function shouldEscalateRepeatedArtifactSignals(input: PhaseTransitionInput, phase: Extract<Phase, "develop" | "review" | "test">): TransitionAction | null {
  const signature = buildArtifactSignalSignature(input, phase)
  if (!signature || input.runtime.lastArtifactSignalSignature !== signature) {
    return null
  }

  if (getPhaseDispatchAttempts(input.runtime, phase) < MAX_REPEATED_ARTIFACT_SIGNAL_DISPATCH_ATTEMPTS) {
    return null
  }

  const missingSignals = input.artifact.missing.length > 0
    ? `Missing signals: ${input.artifact.missing.join(", ")}`
    : "No blocking signals detected."
  const warningSignals = input.artifact.warnings && input.artifact.warnings.length > 0
    ? `Warnings: ${input.artifact.warnings.join(", ")}`
    : "No warning signals detected."

  const action: HumanAction = {
    type: "blocked",
    workflowId: input.workflow.workflowId,
    phase,
    reason: `${phase} repeated the same artifact validation signals and needs human decision`,
    required: true,
    createdAt: new Date().toISOString(),
    summary: [input.artifact.summary, missingSignals, warningSignals].filter(Boolean).join(" | "),
  }
  return { type: "wait_human", action }
}

function nextPhaseFor(current: Phase): Phase | null {
  if (current === "spec_refinement") return "plan"
  if (current === "plan") return "develop"
  if (current === "develop") return "review"
  if (current === "review") return "test"
  if (current === "test") return "done"
  return null
}

function buildHumanAction(input: PhaseTransitionInput): HumanAction | null {
  const { workflow, runtime, artifact } = input
  const createdAt = new Date().toISOString()

  if (artifact.questions && artifact.questions.length > 0) {
    const action: HumanAction = {
      type: "need_answers",
      workflowId: workflow.workflowId,
      phase: workflow.phase,
      reason: "Questions must be answered before continuing",
      required: true,
      questions: artifact.questions,
      createdAt,
    }
    const summary = artifact.summary
    if (workflow.phase === "spec_refinement" && (runtime.refinementAttempts ?? 0) >= MAX_SPEC_REFINEMENT_SELF_REPAIR_ATTEMPTS) {
      action.summary = summary
        ? `${summary} | Autonomous refinement retry budget exhausted; human clarification required.`
        : "Autonomous refinement retry budget exhausted; human clarification required."
    } else if (summary) {
      action.summary = summary
    }
    return action
  }

  if (workflow.phase === "plan" && artifact.requiresApproval && !workflow.approved) {
    const action: HumanAction = {
      type: "need_approval",
      workflowId: workflow.workflowId,
      phase: workflow.phase,
      reason: "Plan is ready and requires approval before development",
      required: true,
      createdAt,
    }
    if (artifact.summary) {
      action.summary = artifact.summary
    }
    return action
  }

  return null
}

export class DefaultPhaseTransition implements PhaseTransition {
  async decide(input: PhaseTransitionInput): Promise<TransitionAction> {
    const { workflow, runtime, currentHumanAction, session, artifact, hasRunningSubtasks } = input

    if (workflow.phase === "done" || workflow.status === "completed") {
      return { type: "stop", reason: "Workflow already completed" }
    }

    if (workflow.phase === "blocked" || workflow.status === "blocked") {
      return { type: "stop", reason: workflow.blockReason ?? "Workflow is blocked" }
    }

    if (currentHumanAction && currentHumanAction.status !== "consumed") {
      return { type: "stop", reason: "Waiting for existing human action" }
    }

    if (hasRunningSubtasks) {
      return { type: "stop", reason: "Background work still in progress" }
    }

    if (session.status === "failed") {
      if (runtime.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return { type: "recover", reason: "Exceeded consecutive failure retry budget" }
      }
      return { type: "recover", reason: "Relevant session failed" }
    }

    if (
      workflow.phase === "spec_refinement"
      && artifact.questions
      && artifact.questions.length > 0
      && (runtime.refinementAttempts ?? 0) < MAX_SPEC_REFINEMENT_SELF_REPAIR_ATTEMPTS
      && (session.status === "missing" || session.status === "idle" || session.status === "stale")
    ) {
      return {
        type: "dispatch",
        phase: workflow.phase,
        reason: `Refinement self-repair attempt ${(runtime.refinementAttempts ?? 0) + 1}`,
      }
    }

    if (workflow.phase === "plan" && workflow.status === "pending" && !workflow.approved) {
      return {
        type: "dispatch",
        phase: workflow.phase,
        reason: "Draft plan from approved refinement artifact",
      }
    }

    const humanAction = buildHumanAction(input)
    if (humanAction) {
      return { type: "wait_human", action: humanAction }
    }

    if (workflow.phase === "plan" && workflow.approved) {
      return {
        type: "advance_phase",
        nextPhase: "develop",
        reason: "Plan was approved",
      }
    }

    if (workflow.phase === "review") {
      if (workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const repeatedSignalEscalation = shouldEscalateRepeatedArtifactSignals(input, "review")
        if (repeatedSignalEscalation) {
          return repeatedSignalEscalation
        }
      }

      if (artifact.reportStatus === "pass") {
        return {
          type: "advance_phase",
          nextPhase: "test",
          reason: "Review passed",
        }
      }

      if (artifact.reportStatus === "fail") {
        if (artifact.hasBlockingSeverity) {
      if (workflow.iteration + 1 >= workflow.maxIterations) {
        return {
          type: "recover",
          reason: "Exceeded maxIterations while fixing review issues",
            }
          }

          return {
            type: "advance_phase",
            nextPhase: "develop",
            reason: "Review failed with blocker severity; loop back to develop",
          }
        }

        const action: HumanAction = {
          type: "blocked",
          workflowId: workflow.workflowId,
          phase: workflow.phase,
          reason: "Review failed without blocker severity and needs human decision",
          required: true,
          createdAt: new Date().toISOString(),
        }
        if (artifact.summary) {
          action.summary = artifact.summary
        }
        return { type: "wait_human", action }
      }

      if (workflow.status === "pending") {
        return {
          type: "dispatch",
          phase: workflow.phase,
          reason: `Continue phase ${workflow.phase}`,
        }
      }

      if (artifact.reportStatus === "unknown" && workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const escalation = shouldEscalateUnknownConclusion(input, "review")
        if (escalation) {
          return escalation
        }
        return {
          type: "dispatch",
          phase: workflow.phase,
          reason: "Review conclusion is still ambiguous; set an explicit PASS or FAIL conclusion",
        }
      }
    }

    if (workflow.phase === "test") {
      if (workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const repeatedSignalEscalation = shouldEscalateRepeatedArtifactSignals(input, "test")
        if (repeatedSignalEscalation) {
          return repeatedSignalEscalation
        }
      }

      if (artifact.valid && artifact.missing.length === 0 && artifact.reportStatus === "pass") {
        return {
          type: "advance_phase",
          nextPhase: "done",
          reason: "Test passed",
        }
      }

      if (artifact.reportStatus === "fail") {
        const action: HumanAction = {
          type: "blocked",
          workflowId: workflow.workflowId,
          phase: workflow.phase,
          reason: "Test failed and needs human decision",
          required: true,
          createdAt: new Date().toISOString(),
        }
        if (artifact.summary) {
          action.summary = artifact.summary
        }
        return { type: "wait_human", action }
      }

      if (workflow.status === "pending") {
        return {
          type: "dispatch",
          phase: workflow.phase,
          reason: `Continue phase ${workflow.phase}`,
        }
      }

      if (artifact.reportStatus === "unknown" && workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const escalation = shouldEscalateUnknownConclusion(input, "test")
        if (escalation) {
          return escalation
        }
        return {
          type: "dispatch",
          phase: workflow.phase,
          reason: "Test conclusion is still ambiguous; set an explicit PASS or FAIL conclusion",
        }
      }
    }

    if (workflow.phase === "develop") {
      if (workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const repeatedSignalEscalation = shouldEscalateRepeatedArtifactSignals(input, "develop")
        if (repeatedSignalEscalation) {
          return repeatedSignalEscalation
        }
      }
    }

    if (artifact.readyForNextPhase) {
      const nextPhase = nextPhaseFor(workflow.phase)
      if (nextPhase) {
        return {
          type: "advance_phase",
          nextPhase,
          reason: `${workflow.phase} is complete`,
        }
      }

      return { type: "stop", reason: "No further phase available" }
    }

    if (session.status === "missing" || session.status === "idle" || session.status === "stale") {
      return {
        type: "dispatch",
        phase: workflow.phase,
        reason: `Continue phase ${workflow.phase}`,
      }
    }

    return { type: "stop", reason: "Relevant session already running" }
  }
}
