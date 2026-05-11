import type { WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../../../core/src/state/workflow-state"

export interface WorkflowStateStore {
  getWorkflow(workflowId: string): Promise<WorkflowState | null>
  saveWorkflow(state: WorkflowState): Promise<void>
  updateWorkflow(
    workflowId: string,
    patch: Partial<WorkflowState>,
  ): Promise<WorkflowState>
  listWorkflows?(): Promise<WorkflowState[]>

  getRuntime(workflowId: string): Promise<WorkflowRuntimeState | null>
  saveRuntime(state: WorkflowRuntimeState): Promise<void>
  updateRuntime(
    workflowId: string,
    patch: Partial<WorkflowRuntimeState>,
  ): Promise<WorkflowRuntimeState>
}
