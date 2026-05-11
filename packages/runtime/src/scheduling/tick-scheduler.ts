export interface TickScheduler {
  requestTick(workflowId: string, reason: string): Promise<void>
}
