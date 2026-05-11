import type { Phase, WorkflowStatus } from "./phase"

export interface WorkflowState {
  workflowId: string
  phase: Phase
  status: WorkflowStatus
  approved: boolean
  iteration: number
  maxIterations: number
  blockReason: string | null
  activeSessionId: string | null
  phaseEnteredAt: string
  updatedAt: string
}
