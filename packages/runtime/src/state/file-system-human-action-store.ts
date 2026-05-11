import { readdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import type { HumanAction } from "../../../core/src/human-actions/human-action"
import type { HumanActionRecord, HumanActionStatus } from "../../../core/src/human-actions/human-action-record"
import { readJsonFile, writeJsonFile } from "../shared/json-file"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"
import type { HumanActionStore } from "./human-action-store"

export class FileSystemHumanActionStore implements HumanActionStore {
  constructor(private readonly workspace: WorkflowWorkspace) {}

  async create(action: HumanAction): Promise<HumanActionRecord> {
    const record: HumanActionRecord = {
      id: randomUUID(),
      workflowId: action.workflowId,
      action,
      status: "pending",
      createdAt: new Date().toISOString(),
    }
    await writeJsonFile(this.workspace.humanActionFile(action.workflowId), record)
    return record
  }

  async getCurrent(workflowId: string): Promise<HumanActionRecord | null> {
    return readJsonFile<HumanActionRecord>(this.workspace.humanActionFile(workflowId))
  }

  private async updateStatus(actionId: string, status: HumanActionStatus): Promise<void> {
    const current = await this.findByActionId(actionId)
    if (!current) {
      throw new Error(`Human action not found: ${actionId}`)
    }

    const next: HumanActionRecord = {
      ...current,
      status,
    }
    if (status === "responded" || status === "consumed") {
      next.respondedAt = new Date().toISOString()
    } else if (current.respondedAt) {
      next.respondedAt = current.respondedAt
    }
    await writeJsonFile(this.workspace.humanActionFile(current.workflowId), next)
  }

  async markPresented(actionId: string): Promise<void> {
    await this.updateStatus(actionId, "presented")
  }

  async markResponded(actionId: string): Promise<void> {
    await this.updateStatus(actionId, "responded")
  }

  async markConsumed(actionId: string): Promise<void> {
    await this.updateStatus(actionId, "consumed")
  }

  private async findByActionId(actionId: string): Promise<HumanActionRecord | null> {
    const workflowsDir = this.workspace.workflowsRoot()
    let workflowIds: string[] = []

    try {
      workflowIds = (await readdir(workflowsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes("ENOENT")) {
        throw error
      }
    }

    for (const workflowId of workflowIds) {
      const current = await this.getCurrent(workflowId)
      if (current?.id === actionId) {
        return current
      }
    }

    return null
  }
}
