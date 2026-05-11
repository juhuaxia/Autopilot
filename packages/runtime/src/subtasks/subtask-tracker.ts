export interface SubtaskTracker {
  hasRunningSubtasks(workflowId: string): Promise<boolean>
}
