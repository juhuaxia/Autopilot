import type { WorkflowState } from "../../../core/src/state/workflow-state"
import type { WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { FileSystemArtifactEvaluator } from "../artifacts/file-system-artifact-evaluator"
import type { WorkflowStateStore } from "../state/workflow-state-store"

export async function initializeWorkflow(args: {
  workflowId: string
  stateStore: WorkflowStateStore
  artifactEvaluator: FileSystemArtifactEvaluator
  userRequest?: string
  startAt?: "spec_refinement" | "develop"
  presetMode?: WorkflowRuntimeState["presetMode"]
}): Promise<void> {
  const { workflowId, stateStore, artifactEvaluator, userRequest, startAt = "spec_refinement", presetMode = null } = args
  const existing = await stateStore.getWorkflow(workflowId)
  if (existing) {
    return
  }

  const now = new Date().toISOString()
  const workflow: WorkflowState = {
    workflowId,
    phase: startAt,
    status: "pending",
    approved: false,
    iteration: 0,
    maxIterations: 3,
    blockReason: null,
    activeSessionId: null,
    phaseEnteredAt: now,
    updatedAt: now,
  }

  const runtime: WorkflowRuntimeState = {
    workflowId,
    preferredForegroundSessionId: null,
    blockedFromPhase: null,
    recoveryState: "idle",
    waitingHumanActionId: null,
    consecutiveFailures: 0,
    refinementAttempts: 0,
    refinementLastDispatchSummary: null,
    refinementEscalationReason: null,
    phaseDispatchAttempts: {},
    lastArtifactSignalSignature: null,
    developArtifactRepairDispatchPending: false,
    reviewArtifactRepairDispatchPending: false,
    testArtifactRepairDispatchPending: false,
    pendingBlockedDecision: null,
    presetMode,
    startMode: startAt === "develop" ? "direct-develop" : "normal",
    skippedPhases: startAt === "develop" ? ["spec_refinement", "plan"] : [],
    outOfBandEditsDetected: false,
    resyncCount: 0,
    lastResyncedAt: null,
    resyncedFromPhase: null,
  }

  await stateStore.saveWorkflow(workflow)
  await stateStore.saveRuntime(runtime)
  await artifactEvaluator.ensureDefaultForStartAt(workflowId, userRequest, startAt)
}
