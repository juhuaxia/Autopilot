import type { TickScheduler } from "../scheduling/tick-scheduler"
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
            const shouldStop = await this.requestTickSafely(workflowId, "session idle")
            if (shouldStop) {
              return
            }
          }
          if (event.type === "session.error") {
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
