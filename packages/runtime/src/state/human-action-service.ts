import type { FileSystemArtifactEvaluator } from "../artifacts/file-system-artifact-evaluator"
import type { WorkflowEventStore } from "../events/workflow-event-store"
import type { TickScheduler } from "../scheduling/tick-scheduler"
import type { HumanActionStore } from "./human-action-store"
import type { WorkflowStateStore } from "./workflow-state-store"

export interface HumanActionService {
  answer(workflowId: string, answers: Record<string, string>): Promise<void>
  approve(workflowId: string): Promise<void>
  resume(workflowId: string): Promise<void>
}

export class DefaultHumanActionService implements HumanActionService {
  constructor(
    private readonly humanActionStore: HumanActionStore,
    private readonly stateStore: WorkflowStateStore,
    private readonly artifactEvaluator: FileSystemArtifactEvaluator,
    private readonly tickScheduler: TickScheduler,
    private readonly eventStore: WorkflowEventStore,
  ) {}

  async answer(workflowId: string, answers: Record<string, string>): Promise<void> {
    const current = await this.humanActionStore.getCurrent(workflowId)
    if (current) {
      await this.humanActionStore.markResponded(current.id)
      await this.humanActionStore.markConsumed(current.id)
    }

    await this.artifactEvaluator.answerQuestions(workflowId, answers)
    await this.stateStore.updateWorkflow(workflowId, {
      status: "in_progress",
    })
    await this.stateStore.updateRuntime(workflowId, {
      waitingHumanActionId: null,
      refinementAttempts: 0,
      refinementEscalationReason: null,
      lastArtifactSignalSignature: null,
    })
    await this.eventStore.append({
      workflowId,
      type: "human_action.resolved",
      at: new Date().toISOString(),
      payload: { actionType: "need_answers" },
    })
    await this.tickScheduler.requestTick(workflowId, "human answered")
  }

  async approve(workflowId: string): Promise<void> {
    const current = await this.humanActionStore.getCurrent(workflowId)
    if (current) {
      await this.humanActionStore.markResponded(current.id)
      await this.humanActionStore.markConsumed(current.id)
    }

    await this.stateStore.updateWorkflow(workflowId, {
      approved: true,
      status: "pending",
    })
    await this.stateStore.updateRuntime(workflowId, {
      waitingHumanActionId: null,
      lastArtifactSignalSignature: null,
    })
    await this.eventStore.append({
      workflowId,
      type: "human_action.resolved",
      at: new Date().toISOString(),
      payload: { actionType: "need_approval" },
    })
    await this.tickScheduler.requestTick(workflowId, "human approved")
  }

  async resume(workflowId: string): Promise<void> {
    const current = await this.humanActionStore.getCurrent(workflowId)
    if (current) {
      await this.humanActionStore.markResponded(current.id)
      await this.humanActionStore.markConsumed(current.id)
    }

    await this.stateStore.updateWorkflow(workflowId, {
      status: "pending",
      blockReason: null,
    })
    await this.stateStore.updateRuntime(workflowId, {
      waitingHumanActionId: null,
      recoveryState: "idle",
      lastArtifactSignalSignature: null,
    })
    await this.eventStore.append({
      workflowId,
      type: "human_action.resolved",
      at: new Date().toISOString(),
      payload: { actionType: "blocked" },
    })
    await this.tickScheduler.requestTick(workflowId, "manual resume")
  }
}
