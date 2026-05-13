export type RecoveryState = "idle" | "recovering"

export type PhaseDispatchAttempts = Partial<Record<"spec_refinement" | "plan" | "develop" | "review" | "test", number>>

export interface WorkflowRuntimeState {
  workflowId: string
  preferredForegroundSessionId?: string | null
  leaseOwner?: string
  leaseExpiresAt?: string
  blockedFromPhase?: Exclude<import("./phase").Phase, "blocked"> | null
  recoveryState: RecoveryState
  waitingHumanActionId?: string | null
  consecutiveFailures: number
  refinementAttempts?: number
  refinementLastDispatchSummary?: string | null
  refinementEscalationReason?: string | null
  lastContinuationAt?: string
  phaseDispatchAttempts?: PhaseDispatchAttempts
  lastArtifactSignalSignature?: string | null
  developArtifactRepairDispatchPending?: boolean
  reviewArtifactRepairDispatchPending?: boolean
  testArtifactRepairDispatchPending?: boolean
}
