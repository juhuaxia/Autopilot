import type { ArtifactEvaluator } from "../../../core/src/artifacts/artifact-evaluator"
import type { PhaseTransition } from "../../../core/src/transitions/phase-transition"
import type { RecoveryClassifier } from "../recovery/recovery-classifier"
import type { TickScheduler } from "../scheduling/tick-scheduler"
import type { SessionCoordinator } from "../sessions/session-coordinator"
import type { HumanActionStore } from "../state/human-action-store"
import type { WorkflowStateStore } from "../state/workflow-state-store"
import type { SubtaskTracker } from "../subtasks/subtask-tracker"
import type { WorkflowEventStore } from "../events/workflow-event-store"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"
import type { ResolvedWorkflowConfig } from "../config/workflow-config"
import type { ImageSummaryService } from "../images/image-summary-service"
import type { ReviewSidecarManager } from "../review/review-sidecar-manager"

export interface WorkflowEngine {
  tick(workflowId: string): Promise<void>
}

export interface WorkflowEngineDeps {
  stateStore: WorkflowStateStore
  humanActionStore: HumanActionStore
  artifactEvaluator: ArtifactEvaluator
  phaseTransition: PhaseTransition
  sessionCoordinator: SessionCoordinator
  recoveryClassifier: RecoveryClassifier
  subtaskTracker: SubtaskTracker
  tickScheduler: TickScheduler
  eventStore: WorkflowEventStore
  workspace: WorkflowWorkspace
  resolvedConfig?: ResolvedWorkflowConfig
  skillRegistry?: Map<string, string>
  imageSummaryService: ImageSummaryService
  reviewSidecarManager: ReviewSidecarManager
}
