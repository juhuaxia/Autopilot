export interface WorkflowEventRecord {
  workflowId: string
  type: string
  at: string
  payload?: Record<string, unknown>
}

export interface WorkflowEventStore {
  append(event: WorkflowEventRecord): Promise<void>
  list(workflowId: string): Promise<WorkflowEventRecord[]>
}
