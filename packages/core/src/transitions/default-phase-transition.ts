import type { HumanAction } from "../human-actions/human-action"
import type { Phase } from "../state/phase"
import type { BlockedDecision } from "../state/workflow-runtime-state"
import type { PhaseTransition, PhaseTransitionInput } from "./phase-transition"
import type { TransitionAction } from "./transition-action"

const MAX_SPEC_REFINEMENT_SELF_REPAIR_ATTEMPTS = 1
const MAX_CONSECUTIVE_FAILURES = 3
const MAX_REVIEW_OR_TEST_UNKNOWN_DISPATCH_ATTEMPTS = 3
const MAX_REPEATED_ARTIFACT_SIGNAL_DISPATCH_ATTEMPTS = 3

export const ARTIFACT_REPAIR_REASON_PREFIX = "Artifact-only repair:"

function getPhaseDispatchAttempts(runtime: PhaseTransitionInput["runtime"], phase: Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">): number {
  return runtime.phaseDispatchAttempts?.[phase] ?? 0
}

function buildBlockedAction(args: {
  workflowId: string
  phase: Phase
  reason: string
  summary?: string
}): TransitionAction {
  return {
    type: "wait_human",
    action: {
      type: "blocked",
      workflowId: args.workflowId,
      phase: args.phase,
      reason: args.reason,
      required: true,
      createdAt: new Date().toISOString(),
      ...(args.summary ? { summary: args.summary } : {}),
    },
  }
}

function isArtifactRepairPending(
  runtime: PhaseTransitionInput["runtime"],
  phase: Extract<Phase, "develop" | "review" | "test">,
): boolean {
  if (phase === "develop") {
    return runtime.developArtifactRepairDispatchPending === true
  }
  if (phase === "review") {
    return runtime.reviewArtifactRepairDispatchPending === true
  }
  return runtime.testArtifactRepairDispatchPending === true
}

function buildArtifactOnlyRepairReason(phase: Extract<Phase, "develop" | "review" | "test">): string {
  const artifactName = `${phase}.md`
  return `${ARTIFACT_REPAIR_REASON_PREFIX} ${phase} artifact still matches its template. Do not modify code. Only update ${artifactName} with actual ${phase} results, replace template placeholders, and set the required completion/conclusion sections correctly.`
}

function buildRepeatedSignalBlockedDiagnostic(input: PhaseTransitionInput, phase: Extract<Phase, "develop" | "review" | "test">): {
  reason: string
  summary: string
} {
  const missingSignals = input.artifact.missing.length > 0
    ? `Missing signals: ${input.artifact.missing.join(", ")}`
    : "No blocking signals detected."
  const warningSignals = input.artifact.warnings && input.artifact.warnings.length > 0
    ? `Warnings: ${input.artifact.warnings.join(", ")}`
    : "No warning signals detected."

  if (input.artifact.missing.includes("artifact_unchanged_from_template")) {
    const artifactName = `${phase}.md`
    return {
      reason: `${phase} artifact stayed at template/stale state after the artifact-only repair attempt and now needs human decision. Missing sections/signals: ${input.artifact.missing.join(", ")}. Suggested recovery: inspect the existing work, then ask the agent to update only ${artifactName} or manually fix the artifact before resume.`,
      summary: [
        input.artifact.summary,
        `The ${phase} artifact still looks unfinished or template-derived.`,
        `Recommended next step: repair ${artifactName} before resuming the workflow.`,
        missingSignals,
        warningSignals,
      ].filter(Boolean).join(" | "),
    }
  }

  return {
    reason: `${phase} repeated the same artifact validation signals and needs human decision.${input.artifact.missing.length > 0 ? ` Missing sections/signals: ${input.artifact.missing.join(", ")}.` : ""}`,
    summary: [input.artifact.summary, missingSignals, warningSignals].filter(Boolean).join(" | "),
  }
}

function buildUnknownConclusionBlockedDiagnostic(input: PhaseTransitionInput, phase: "review" | "test"): {
  reason: string
  summary?: string
} {
  return {
    reason: `${phase} exceeded dispatch retry budget and needs human decision`,
    ...(input.artifact.summary ? { summary: input.artifact.summary } : {}),
  }
}

function buildReportFailureBlockedDiagnostic(input: PhaseTransitionInput, phase: "review" | "test"): {
  reason: string
  summary?: string
  allowedDecisions: BlockedDecision[]
} {
  return {
    reason: phase === "review"
      ? "Review failed without blocker severity and needs human decision"
      : "Test failed and needs human decision",
    allowedDecisions: ["fix", "accept"],
    ...(input.artifact.summary ? { summary: input.artifact.summary } : {}),
  }
}

function consumeBlockedDecision(input: PhaseTransitionInput, phase: "review" | "test"): TransitionAction | null {
  const decision = input.runtime.pendingBlockedDecision?.decision
  if (!decision) {
    return null
  }

  if (phase === "review") {
    return decision === "fix"
      ? { type: "advance_phase", nextPhase: "develop", reason: "Manual decision: fix review issues" }
      : { type: "advance_phase", nextPhase: "test", reason: "Manual decision: accept current review state and continue" }
  }

  return decision === "fix"
    ? { type: "advance_phase", nextPhase: "develop", reason: "Manual decision: return to develop from failed test" }
    : { type: "advance_phase", nextPhase: "done", reason: "Manual decision: accept current test state and finish workflow" }
}

function shouldEscalateUnknownConclusion(input: PhaseTransitionInput, phase: "review" | "test"): TransitionAction | null {
  if (getPhaseDispatchAttempts(input.runtime, phase) < MAX_REVIEW_OR_TEST_UNKNOWN_DISPATCH_ATTEMPTS) {
    return null
  }

  const diagnostic = buildUnknownConclusionBlockedDiagnostic(input, phase)
  return buildBlockedAction({
    workflowId: input.workflow.workflowId,
    phase,
    reason: diagnostic.reason,
    ...(diagnostic.summary ? { summary: diagnostic.summary } : {}),
  })
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

  const diagnostic = buildRepeatedSignalBlockedDiagnostic(input, phase)
  return buildBlockedAction({
    workflowId: input.workflow.workflowId,
    phase,
    reason: diagnostic.reason,
    ...(diagnostic.summary ? { summary: diagnostic.summary } : {}),
  })
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
      const manualDecision = consumeBlockedDecision(input, "review")
      if (manualDecision) {
        return manualDecision
      }

      if (workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const repeatedSignalEscalation = shouldEscalateRepeatedArtifactSignals(input, "review")
        if (repeatedSignalEscalation) {
          if (
            !isArtifactRepairPending(input.runtime, "review")
            && input.artifact.missing.includes("artifact_unchanged_from_template")
          ) {
            return {
              type: "dispatch",
              phase: workflow.phase,
              reason: buildArtifactOnlyRepairReason("review"),
            }
          }
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

        const diagnostic = buildReportFailureBlockedDiagnostic(input, "review")
        return buildBlockedAction({
          workflowId: workflow.workflowId,
          phase: workflow.phase,
          reason: diagnostic.reason,
          ...(diagnostic.summary ? { summary: diagnostic.summary } : {}),
        })
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
      const manualDecision = consumeBlockedDecision(input, "test")
      if (manualDecision) {
        return manualDecision
      }

      if (workflow.status === "in_progress" && (session.status === "idle" || session.status === "stale")) {
        const repeatedSignalEscalation = shouldEscalateRepeatedArtifactSignals(input, "test")
        if (repeatedSignalEscalation) {
          if (
            !isArtifactRepairPending(input.runtime, "test")
            && input.artifact.missing.includes("artifact_unchanged_from_template")
          ) {
            return {
              type: "dispatch",
              phase: workflow.phase,
              reason: buildArtifactOnlyRepairReason("test"),
            }
          }
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
        const diagnostic = buildReportFailureBlockedDiagnostic(input, "test")
        return buildBlockedAction({
          workflowId: workflow.workflowId,
          phase: workflow.phase,
          reason: diagnostic.reason,
          ...(diagnostic.summary ? { summary: diagnostic.summary } : {}),
        })
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
          if (
            !isArtifactRepairPending(input.runtime, "develop")
            && input.artifact.missing.includes("artifact_unchanged_from_template")
          ) {
            return {
              type: "dispatch",
              phase: workflow.phase,
              reason: buildArtifactOnlyRepairReason("develop"),
            }
          }
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
