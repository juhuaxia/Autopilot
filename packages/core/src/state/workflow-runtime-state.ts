export type RecoveryState = "idle" | "recovering"

export interface WorkflowRuntimeState {
  workflowId: string
  preferredForegroundSessionId?: string | null
  leaseOwner?: string
  leaseExpiresAt?: string
  recoveryState: RecoveryState
  waitingHumanActionId?: string | null
  consecutiveFailures: number
  refinementAttempts?: number
  refinementLastDispatchSummary?: string | null
  refinementEscalationReason?: string | null
  lastContinuationAt?: string
}
