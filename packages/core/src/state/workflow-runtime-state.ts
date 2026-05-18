export type RecoveryState = "idle" | "recovering"

export type PhaseDispatchAttempts = Partial<Record<"spec_refinement" | "plan" | "develop" | "review" | "test", number>>

export type BlockedDecision = "fix" | "accept"

export type WorkflowStartMode = "normal" | "direct-develop"
export type WorkflowPresetMode = "light" | "standard" | "safe" | "debug" | "review-heavy" | "verify"
export type WorkflowRunKind = "full" | "review-heavy" | "develop" | "verify"

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
  pendingBlockedDecision?: {
    actionId: string
    decision: BlockedDecision
    decidedAt: string
  } | null
  presetMode?: WorkflowPresetMode | null
  runKind?: WorkflowRunKind
  parentWorkflowId?: string | null
  sourceWorkflowId?: string | null
  startMode?: WorkflowStartMode
  skippedPhases?: Array<Extract<import("./phase").Phase, "spec_refinement" | "plan">>
  outOfBandEditsDetected?: boolean
  resyncCount?: number
  lastResyncedAt?: string | null
  resyncedFromPhase?: Extract<import("./phase").Phase, "review" | "test"> | null
  reviewReadyToConsolidate?: boolean
  reviewConsolidationDispatched?: boolean
}
