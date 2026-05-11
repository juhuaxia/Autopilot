import type { HumanAction } from "../human-actions/human-action"
import type { Phase } from "../state/phase"
import type { PhaseTransition, PhaseTransitionInput } from "./phase-transition"
import type { TransitionAction } from "./transition-action"

const MAX_SPEC_REFINEMENT_SELF_REPAIR_ATTEMPTS = 1

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
    }

    if (workflow.phase === "test") {
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
