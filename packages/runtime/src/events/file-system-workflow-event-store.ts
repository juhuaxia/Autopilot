import { appendFile, readFile } from "node:fs/promises"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"
import type { WorkflowEventRecord, WorkflowEventStore } from "./workflow-event-store"

export class FileSystemWorkflowEventStore implements WorkflowEventStore {
  constructor(private readonly workspace: WorkflowWorkspace) {}

  async append(event: WorkflowEventRecord): Promise<void> {
    const line = `${JSON.stringify(event)}\n`
    await appendFile(this.workspace.eventsFile(event.workflowId), line, "utf8")
  }

  async list(workflowId: string): Promise<WorkflowEventRecord[]> {
    try {
      const content = await readFile(this.workspace.eventsFile(workflowId), "utf8")
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as WorkflowEventRecord)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("ENOENT")) {
        return []
      }
      throw error
    }
  }
}
