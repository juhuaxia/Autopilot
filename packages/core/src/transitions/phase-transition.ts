import type { ArtifactEvaluation } from "../artifacts/artifact-evaluator"
import type { HumanActionRecord } from "../human-actions/human-action-record"
import type { WorkflowRuntimeState } from "../state/workflow-runtime-state"
import type { WorkflowState } from "../state/workflow-state"
import type { TransitionAction } from "./transition-action"

export interface RelevantSessionState {
  sessionId: string | null
  relevant: boolean
  status: "missing" | "running" | "idle" | "failed" | "stale"
  phaseMatches: boolean
}

export interface PhaseTransitionInput {
  workflow: WorkflowState
  runtime: WorkflowRuntimeState
  artifact: ArtifactEvaluation
  currentHumanAction: HumanActionRecord | null
  session: RelevantSessionState
  hasRunningSubtasks: boolean
}

export interface PhaseTransition {
  decide(input: PhaseTransitionInput): Promise<TransitionAction>
}
