import type { SubtaskTracker } from "./subtask-tracker"

export class NoopSubtaskTracker implements SubtaskTracker {
  async hasRunningSubtasks(_workflowId: string): Promise<boolean> {
    return false
  }
}
