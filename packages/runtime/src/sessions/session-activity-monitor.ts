import type { TickScheduler } from "../scheduling/tick-scheduler"
import type { ReviewSidecarManager } from "../review/review-sidecar-manager"
import type { WorkflowStateStore } from "../state/workflow-state-store"
import type { SessionCoordinator, SessionDescriptor } from "./session-coordinator"

export interface SessionActivityMonitor {
  start(workflowId: string): Promise<void>
  stop(workflowId: string): Promise<void>
}

export class DefaultSessionActivityMonitor implements SessionActivityMonitor {
  private static readonly activeControllers = new Map<string, AbortController>()
  private readonly running = new Map<string, AbortController>()

  constructor(
    private readonly scopeKey: string,
    private readonly stateStore: WorkflowStateStore,
    private readonly sessionCoordinator: SessionCoordinator,
    private readonly reviewSidecarManager: ReviewSidecarManager,
    private readonly tickScheduler: TickScheduler,
  ) {}

  async start(workflowId: string): Promise<void> {
    const monitorKey = this.keyFor(workflowId)
    if (this.running.has(monitorKey)) {
      return
    }

    const active = DefaultSessionActivityMonitor.activeControllers.get(monitorKey)
    if (active) {
      active.abort()
    }

    const controller = new AbortController()
    this.running.set(monitorKey, controller)
    DefaultSessionActivityMonitor.activeControllers.set(monitorKey, controller)

    void this.runLoop(workflowId, monitorKey, controller.signal)
    void this.runReviewerSyncLoop(workflowId, monitorKey, controller.signal)
  }

  async stop(workflowId: string): Promise<void> {
    const monitorKey = this.keyFor(workflowId)
    const controller = this.running.get(monitorKey)
    if (!controller) {
      return
    }
    controller.abort()
    this.running.delete(monitorKey)
    if (DefaultSessionActivityMonitor.activeControllers.get(monitorKey) === controller) {
      DefaultSessionActivityMonitor.activeControllers.delete(monitorKey)
    }
  }

  private async runLoop(workflowId: string, monitorKey: string, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        const workflow = await this.stateStore.getWorkflow(workflowId)
        if (!workflow?.activeSessionId) {
          await this.sleep(100, signal)
          continue
        }

        const coordinator = this.sessionCoordinator as SessionCoordinator & {
          getStoredSession?(workflowId: string, sessionId: string): Promise<SessionDescriptor | null>
        }
        const stored = coordinator.getStoredSession
          ? await coordinator.getStoredSession(workflowId, workflow.activeSessionId)
          : null
        if (!stored) {
          await this.sleep(100, signal)
          continue
        }

        for await (const event of this.sessionCoordinator.streamEvents(stored)) {
          if (signal.aborted) {
            return
          }
          if (event.type === "session.idle") {
            if (stored.kind === "reviewer") {
              const summary = await this.sessionCoordinator.getLatestAssistantText(stored.sessionId)
              await this.reviewSidecarManager.updateEntrySummary(workflowId, stored.sessionId, summary)
              await this.reviewSidecarManager.updateEntryStatus(workflowId, stored.sessionId, "idle")
              await this.reviewSidecarManager.markCompletedIfSettled(workflowId)
              const sidecar = await this.reviewSidecarManager.read(workflowId)
              if (sidecar?.readyToConsolidate) {
                await this.stateStore.updateRuntime(workflowId, { reviewReadyToConsolidate: true })
                const shouldStop = await this.requestTickSafely(workflowId, "reviewer sidecar ready to consolidate")
                if (shouldStop) {
                  return
                }
              }
              await this.reviewSidecarManager.syncReviewArtifact(workflowId)
              continue
            }
            const shouldStop = await this.requestTickSafely(workflowId, "session idle")
            if (shouldStop) {
              return
            }
          }
          if (event.type === "session.error") {
            if (stored.kind === "reviewer") {
              await this.reviewSidecarManager.updateEntryStatus(
                workflowId,
                stored.sessionId,
                "failed",
                typeof event.payload?.message === "string" ? event.payload.message : undefined,
              )
              await this.reviewSidecarManager.markCompletedIfSettled(workflowId)
              const sidecar = await this.reviewSidecarManager.read(workflowId)
              if (sidecar?.readyToConsolidate) {
                await this.stateStore.updateRuntime(workflowId, { reviewReadyToConsolidate: true })
                const shouldStop = await this.requestTickSafely(workflowId, "reviewer sidecar ready to consolidate")
                if (shouldStop) {
                  return
                }
              }
              await this.reviewSidecarManager.syncReviewArtifact(workflowId)
              continue
            }
            const shouldStop = await this.requestTickSafely(workflowId, "session failed")
            if (shouldStop) {
              return
            }
          }
        }

      }
    } finally {
      this.running.delete(monitorKey)
      const active = DefaultSessionActivityMonitor.activeControllers.get(monitorKey)
      if (active && active.signal === signal) {
        DefaultSessionActivityMonitor.activeControllers.delete(monitorKey)
      }
    }
  }

  private async runReviewerSyncLoop(workflowId: string, monitorKey: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.syncReviewerSessions(workflowId, signal)
      await this.sleep(100, signal)
    }
  }

  private async syncReviewerSessions(workflowId: string, signal: AbortSignal): Promise<void> {
    const sessions = await this.sessionCoordinator.listStoredSessions(workflowId)
    const reviewerSessions = sessions.filter((session) => session.kind === "reviewer" && !session.archived)
    if (reviewerSessions.length === 0) {
      return
    }

    for (const session of reviewerSessions) {
      if (signal.aborted) {
        return
      }
      const latestStatus = await this.sessionCoordinator.getSessionStatus(session.sessionId)
      const normalizedStatus = latestStatus === "missing" ? "failed" : latestStatus
      if (normalizedStatus !== session.status) {
        await this.sessionCoordinator.updateStoredSession(workflowId, session.sessionId, { status: normalizedStatus })
      }

      if (normalizedStatus === "idle") {
        const summary = await this.sessionCoordinator.getLatestAssistantText(session.sessionId)
        if (summary) {
          await this.reviewSidecarManager.updateEntrySummary(workflowId, session.sessionId, summary)
        }
      }

      if (normalizedStatus === "idle" || normalizedStatus === "failed") {
        await this.reviewSidecarManager.updateEntryStatus(workflowId, session.sessionId, normalizedStatus)
      }
    }

    await this.reviewSidecarManager.markCompletedIfSettled(workflowId)
    const sidecar = await this.reviewSidecarManager.read(workflowId)
    if (sidecar?.readyToConsolidate) {
      await this.stateStore.updateRuntime(workflowId, { reviewReadyToConsolidate: true })
    }
    await this.reviewSidecarManager.syncReviewArtifact(workflowId)
  }

  private keyFor(workflowId: string): string {
    return `${this.scopeKey}::${workflowId}`
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), ms)
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
    })
  }

  private async requestTickSafely(workflowId: string, reason: string): Promise<boolean> {
    try {
      await this.tickScheduler.requestTick(workflowId, reason)
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes("Workflow not found")
        || message.includes("Workflow state not found")
        || message.includes("Runtime state not found")
        || message.includes("ENOENT")
        || message.includes("EINVAL")
      ) {
        return true
      }
      throw error
    }
  }
}
