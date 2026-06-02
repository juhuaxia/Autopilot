import type { WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../../../core/src/state/workflow-state"
import { readdir } from "node:fs/promises"
import { readJsonFile, writeJsonFile } from "../shared/json-file"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"
import type { WorkflowStateStore } from "./workflow-state-store"
import { normalizeMaxIterationsForPreset } from "./workflow-iteration-policy"

function normalizeWorkflowState(state: WorkflowState, presetMode?: WorkflowRuntimeState["presetMode"] | null): WorkflowState {
  const nextMaxIterations = normalizeMaxIterationsForPreset(state.maxIterations, presetMode)
  if (state.maxIterations === nextMaxIterations) {
    return state
  }
  return {
    ...state,
    maxIterations: nextMaxIterations,
  }
}

export class FileSystemWorkflowStateStore implements WorkflowStateStore {
  constructor(public readonly workspace: WorkflowWorkspace) {}

  async listWorkflows(): Promise<WorkflowState[]> {
    try {
      const workflowIds = (await readdir(this.workspace.workflowsRoot(), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      const items = await Promise.all(workflowIds.map((workflowId) => this.getWorkflow(workflowId)))
      return items.filter((item): item is WorkflowState => item !== null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("ENOENT")) {
        return []
      }
      throw error
    }
  }

  async getWorkflow(workflowId: string): Promise<WorkflowState | null> {
    const state = await readJsonFile<WorkflowState>(this.workspace.workflowStateFile(workflowId))
    if (!state) {
      return null
    }
    const runtime = await readJsonFile<WorkflowRuntimeState>(this.workspace.workflowRuntimeStateFile(workflowId))
    const normalized = normalizeWorkflowState(state, runtime?.presetMode ?? null)
    if (normalized !== state) {
      await writeJsonFile(this.workspace.workflowStateFile(workflowId), normalized)
    }
    return normalized
  }

  async saveWorkflow(state: WorkflowState): Promise<void> {
    const runtime = await readJsonFile<WorkflowRuntimeState>(this.workspace.workflowRuntimeStateFile(state.workflowId))
    await writeJsonFile(this.workspace.workflowStateFile(state.workflowId), normalizeWorkflowState(state, runtime?.presetMode ?? null))
  }

  async updateWorkflow(
    workflowId: string,
    patch: Partial<WorkflowState>,
  ): Promise<WorkflowState> {
    const current = await this.getWorkflow(workflowId)
    if (!current) {
      throw new Error(`Workflow state not found: ${workflowId}`)
    }

    const next: WorkflowState = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    const runtime = await this.getRuntime(workflowId)
    const normalized = normalizeWorkflowState(next, runtime?.presetMode ?? null)
    await this.saveWorkflow(normalized)
    return normalized
  }

  async getRuntime(workflowId: string): Promise<WorkflowRuntimeState | null> {
    return readJsonFile<WorkflowRuntimeState>(this.workspace.workflowRuntimeStateFile(workflowId))
  }

  async saveRuntime(state: WorkflowRuntimeState): Promise<void> {
    await writeJsonFile(this.workspace.workflowRuntimeStateFile(state.workflowId), state)
  }

  async updateRuntime(
    workflowId: string,
    patch: Partial<WorkflowRuntimeState>,
  ): Promise<WorkflowRuntimeState> {
    const current = await this.getRuntime(workflowId)
    if (!current) {
      throw new Error(`Workflow runtime state not found: ${workflowId}`)
    }

    const next: WorkflowRuntimeState = {
      ...current,
      ...patch,
    }
    await this.saveRuntime(next)
    return next
  }
}
