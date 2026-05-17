import { join } from "node:path"
import type { Phase } from "../../../core/src/state/phase"
import { AUTOPILOT_CONFIG_FILENAME } from "../config/workflow-config"

export interface WorkflowWorkspace {
  baseDir(): string
  workflowsRoot(): string
  workflowConfigFile(): string
  workflowDir(workflowId: string): string
  artifactStateFile(workflowId: string): string
  humanActionFile(workflowId: string): string
  workflowStateFile(workflowId: string): string
  workflowRuntimeStateFile(workflowId: string): string
  sessionsFile(workflowId: string): string
  reviewSidecarFile(workflowId: string): string
  eventsFile(workflowId: string): string
  eventsIndexFile(workflowId: string): string
  phaseArtifactFile(workflowId: string, phase: Phase): string
}

export class DefaultWorkflowWorkspace implements WorkflowWorkspace {
  constructor(private readonly root: string) {}

  private normalizeWorkflowId(workflowId: string): string {
    const normalized = workflowId.trim()
    if (!normalized) {
      throw new Error("workflowId must be a non-empty string")
    }
    if (normalized.includes("..") || normalized.includes("/") || normalized.includes("\\")) {
      throw new Error("workflowId must not contain path separators or traversal sequences")
    }
    return normalized
  }

  baseDir(): string {
    return this.root
  }

  workflowsRoot(): string {
    return join(this.root, "workflows")
  }

  workflowConfigFile(): string {
    return join(this.root, AUTOPILOT_CONFIG_FILENAME)
  }

  workflowDir(workflowId: string): string {
    return join(this.workflowsRoot(), this.normalizeWorkflowId(workflowId))
  }

  artifactStateFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "artifact-state.json")
  }

  humanActionFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "human-action.json")
  }

  workflowStateFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "workflow-state.json")
  }

  workflowRuntimeStateFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "workflow-runtime-state.json")
  }

  sessionsFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "sessions.json")
  }

  reviewSidecarFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "review-sidecar.json")
  }

  eventsFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "events.ndjson")
  }

  eventsIndexFile(workflowId: string): string {
    return join(this.workflowDir(workflowId), "events.json")
  }

  phaseArtifactFile(workflowId: string, phase: Phase): string {
    return join(this.workflowDir(workflowId), `${phase}.md`)
  }
}
