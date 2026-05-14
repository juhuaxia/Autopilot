import type { FileSystemArtifactEvaluator } from "../artifacts/file-system-artifact-evaluator"
import type { WorkflowEventStore } from "../events/workflow-event-store"
import type { TickScheduler } from "../scheduling/tick-scheduler"
import type { BlockedDecision } from "../../../core/src/state/workflow-runtime-state"
import type { HumanActionStore } from "./human-action-store"
import type { WorkflowStateStore } from "./workflow-state-store"

export interface HumanActionService {
  answer(workflowId: string, answers: Record<string, string>): Promise<void>
  approve(workflowId: string): Promise<void>
  resume(workflowId: string, decision?: BlockedDecision): Promise<void>
  resync(workflowId: string): Promise<void>
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
      blockedFromPhase: null,
      waitingHumanActionId: null,
      consecutiveFailures: 0,
      recoveryState: "idle",
      refinementAttempts: 0,
      refinementEscalationReason: null,
      lastArtifactSignalSignature: null,
      developArtifactRepairDispatchPending: false,
      reviewArtifactRepairDispatchPending: false,
      testArtifactRepairDispatchPending: false,
      pendingBlockedDecision: null,
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
      blockedFromPhase: null,
      waitingHumanActionId: null,
      consecutiveFailures: 0,
      recoveryState: "idle",
      lastArtifactSignalSignature: null,
      developArtifactRepairDispatchPending: false,
      reviewArtifactRepairDispatchPending: false,
      testArtifactRepairDispatchPending: false,
      pendingBlockedDecision: null,
    })
    await this.eventStore.append({
      workflowId,
      type: "human_action.resolved",
      at: new Date().toISOString(),
      payload: { actionType: "need_approval" },
    })
    await this.tickScheduler.requestTick(workflowId, "human approved")
  }

  async resume(workflowId: string, decision?: BlockedDecision): Promise<void> {
    const workflow = await this.stateStore.getWorkflow(workflowId)
    const runtime = await this.stateStore.getRuntime(workflowId)
    const current = await this.humanActionStore.getCurrent(workflowId)
    if (current) {
      await this.humanActionStore.markResponded(current.id)
      await this.humanActionStore.markConsumed(current.id)
    }

    await this.stateStore.updateWorkflow(workflowId, {
      ...(workflow?.phase === "blocked" && runtime?.blockedFromPhase
        ? { phase: runtime.blockedFromPhase }
        : {}),
      status: "pending",
      blockReason: null,
    })
    await this.stateStore.updateRuntime(workflowId, {
      blockedFromPhase: null,
      waitingHumanActionId: null,
      recoveryState: "idle",
      consecutiveFailures: 0,
      lastArtifactSignalSignature: null,
      developArtifactRepairDispatchPending: false,
      reviewArtifactRepairDispatchPending: false,
      testArtifactRepairDispatchPending: false,
      pendingBlockedDecision: current && current.action.type === "blocked" && decision
        ? {
            actionId: current.id,
            decision,
            decidedAt: new Date().toISOString(),
          }
        : null,
    })
    await this.eventStore.append({
      workflowId,
      type: "human_action.resolved",
      at: new Date().toISOString(),
      payload: { actionType: "blocked" },
    })
    await this.tickScheduler.requestTick(workflowId, "manual resume")
  }

  async resync(workflowId: string): Promise<void> {
    const workflow = await this.stateStore.getWorkflow(workflowId)
    const runtime = await this.stateStore.getRuntime(workflowId)
    const resyncPhase = workflow?.phase === "blocked"
      ? runtime?.blockedFromPhase
      : workflow?.phase

    if (resyncPhase !== "review" && resyncPhase !== "test") {
      throw new Error("workflow_resync currently supports workflows paused in review or test only")
    }

    await this.artifactEvaluator.resetPhaseForResync(workflowId, resyncPhase)

    const current = await this.humanActionStore.getCurrent(workflowId)
    if (current) {
      await this.humanActionStore.markResponded(current.id)
      await this.humanActionStore.markConsumed(current.id)
    }

    await this.stateStore.updateWorkflow(workflowId, {
      phase: resyncPhase,
      status: "pending",
      blockReason: null,
    })

    await this.stateStore.updateRuntime(workflowId, {
      blockedFromPhase: null,
      waitingHumanActionId: null,
      recoveryState: "idle",
      consecutiveFailures: 0,
      lastArtifactSignalSignature: null,
      developArtifactRepairDispatchPending: false,
      reviewArtifactRepairDispatchPending: false,
      testArtifactRepairDispatchPending: false,
      pendingBlockedDecision: null,
      outOfBandEditsDetected: true,
      resyncCount: (runtime?.resyncCount ?? 0) + 1,
      lastResyncedAt: new Date().toISOString(),
      resyncedFromPhase: resyncPhase,
      phaseDispatchAttempts: {
        ...(runtime?.phaseDispatchAttempts ?? {}),
        [resyncPhase]: 0,
      },
    })

    await this.eventStore.append({
      workflowId,
      type: "workflow.resynced",
      at: new Date().toISOString(),
      payload: {
        phase: resyncPhase,
        strategy: "rerun_current_phase",
      },
    })
    await this.tickScheduler.requestTick(workflowId, `workflow resync: rerun ${resyncPhase}`)
  }
}
