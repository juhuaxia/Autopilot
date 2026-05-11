import type { WorkflowEventStore } from "../events/workflow-event-store"
import type { TickScheduler } from "../scheduling/tick-scheduler"
import type { SessionActivityMonitor } from "../sessions/session-activity-monitor"
import type { WorkflowStateStore } from "../state/workflow-state-store"

export interface AttachService {
  attach(workflowId: string): Promise<void>
}

export class DefaultAttachService implements AttachService {
  constructor(
    private readonly stateStore: WorkflowStateStore,
    private readonly sessionActivityMonitor: SessionActivityMonitor,
    private readonly tickScheduler: TickScheduler,
    private readonly eventStore: WorkflowEventStore,
  ) {}

  async attach(workflowId: string): Promise<void> {
    const workflow = await this.stateStore.getWorkflow(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    await this.sessionActivityMonitor.start(workflowId)
    await this.eventStore.append({
      workflowId,
      type: "workflow.attached",
      at: new Date().toISOString(),
      payload: {
        phase: workflow.phase,
        status: workflow.status,
      },
    })

    if (workflow.phase !== "done" && workflow.phase !== "blocked") {
      await this.tickScheduler.requestTick(workflowId, "workflow attached")
    }
  }
}
