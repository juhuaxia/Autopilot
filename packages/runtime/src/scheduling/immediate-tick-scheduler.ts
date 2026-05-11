import type { TickScheduler } from "./tick-scheduler"

export type TickHandler = (workflowId: string) => Promise<void>

export class ImmediateTickScheduler implements TickScheduler {
  private readonly active = new Set<string>()
  private readonly queued = new Set<string>()
  private handler: TickHandler | null = null

  setHandler(handler: TickHandler): void {
    this.handler = handler
  }

  async requestTick(workflowId: string, _reason: string): Promise<void> {
    if (!this.handler) {
      throw new Error("Tick handler has not been registered")
    }

    if (this.active.has(workflowId)) {
      this.queued.add(workflowId)
      return
    }

    this.active.add(workflowId)
    try {
      await this.handler(workflowId)
      while (this.queued.has(workflowId)) {
        this.queued.delete(workflowId)
        await this.handler(workflowId)
      }
    } finally {
      this.active.delete(workflowId)
    }
  }
}
