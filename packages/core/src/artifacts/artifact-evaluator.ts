import type { Question } from "../human-actions/question"
import type { Phase } from "../state/phase"
import type { WorkflowState } from "../state/workflow-state"

export interface ArtifactEvaluation {
  valid: boolean
  readyForNextPhase: boolean
  missing: string[]
  warnings?: string[]
  summary?: string
  questions?: Question[]
  requiresApproval?: boolean
  reportStatus?: "pass" | "fail" | "unknown"
  hasBlockingSeverity?: boolean
}

export interface ArtifactEvaluator {
  evaluate(state: WorkflowState): Promise<ArtifactEvaluation>
  prepareForPhase?(workflowId: string, phase: Phase, previousPhase: Phase): Promise<void>
}
