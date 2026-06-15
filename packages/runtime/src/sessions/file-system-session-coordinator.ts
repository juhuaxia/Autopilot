import type { Phase } from "../../../core/src/state/phase"
import type { SessionEvent } from "../../../adapters/opencode/src/opencode-session-client"
import type { RelevantSessionState } from "../../../core/src/transitions/phase-transition"
import type { OpencodeSessionClient } from "../../../adapters/opencode/src/opencode-session-client"
import { readJsonFile, writeJsonFile } from "../shared/json-file"
import { buildPromptStorageSummary } from "../shared/prompt-storage-summary"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"
import type { SessionCoordinator, SessionDescriptor } from "./session-coordinator"

type SessionStateFile = {
  sessions: SessionDescriptor[]
}

export class FileSystemSessionCoordinator implements SessionCoordinator {
  constructor(
    private readonly workspace: WorkflowWorkspace,
    private readonly sessionClient: OpencodeSessionClient,
  ) {}

  async getRelevantSession(workflowId: string): Promise<RelevantSessionState> {
    const sessions = await this.loadSessions(workflowId)
    const relevant = [...sessions]
      .reverse()
      .find((session) => !session.archived && session.kind !== "reviewer")
      ?? [...sessions]
      .reverse()
      .find((session) => !session.archived)

    if (!relevant) {
      return {
        sessionId: null,
        relevant: false,
        status: "missing",
        phaseMatches: false,
      }
    }

    const status = await this.sessionClient.getSessionStatus(relevant.sessionId)

    return {
      sessionId: relevant.sessionId,
      relevant: true,
      status,
      phaseMatches: true,
    }
  }

  async ensureSession(workflowId: string, phase: Phase, preferredSessionId?: string | null): Promise<string> {
    const sessions = await this.loadSessions(workflowId)
    if (preferredSessionId && (phase === "develop" || phase === "review" || phase === "test")) {
      const foreground = sessions.find((session) => session.sessionId === preferredSessionId)
      if (foreground) {
        const next = sessions.map((session) => session.sessionId === preferredSessionId
          ? {
              ...session,
              workflowId,
              phase,
              archived: false,
              isForegroundPreferred: true,
            }
          : session)
        await this.saveSessions(workflowId, next)
        return preferredSessionId
      }

    const createdForeground: SessionDescriptor = {
      sessionId: preferredSessionId,
      workflowId,
      phase,
      createdAt: new Date().toISOString(),
      kind: "main",
      isForegroundPreferred: true,
      status: "idle",
      title: `${workflowId}:${phase}`,
    }
      sessions.push(createdForeground)
      await this.saveSessions(workflowId, sessions)
      return preferredSessionId
    }

    const existing = [...sessions]
      .reverse()
      .find((session) => !session.archived && session.phase === phase)

    if (existing) {
      return existing.sessionId
    }

    const sessionTitle = `${workflowId}:${phase}`
    return this.createSession(workflowId, phase, sessionTitle)
  }

  async createSession(
    workflowId: string,
    phase: Phase,
    title: string,
    options?: { kind?: "main" | "reviewer"; roleName?: string },
  ): Promise<string> {
    const sessions = await this.loadSessions(workflowId)
    const created = await this.sessionClient.createSession({
      workflowId,
      phase,
      title,
    })

    const next: SessionDescriptor = {
      sessionId: created.sessionId,
      workflowId,
      phase,
      createdAt: new Date().toISOString(),
      kind: options?.kind ?? "main",
      status: "idle",
      title,
      ...(options?.kind ? { kind: options.kind } : {}),
      ...(options?.roleName ? { roleName: options.roleName } : {}),
    }

    sessions.push(next)
    await this.saveSessions(workflowId, sessions)
    return next.sessionId
  }

  async inject(workflowId: string, sessionId: string, prompt: string): Promise<void> {
    const stored = await this.getStoredSession(workflowId, sessionId)
    if (stored) {
      await this.sessionClient.ensureSessionReady(sessionId, stored.title || `${workflowId}:${stored.phase}`)
    }

    const injectResult = await this.sessionClient.injectPrompt({
      sessionId,
      prompt,
    })
    const currentStatus = await this.sessionClient.getSessionStatus(sessionId)

    const promptStorage = buildPromptStorageSummary(prompt)
    const sessions = await this.loadSessions(workflowId)
    const next = sessions.map((session) => {
      if (session.sessionId !== sessionId) {
        return session
      }

      return {
        ...session,
        status: currentStatus === "failed"
          ? "failed" as const
          : currentStatus === "idle"
            ? "idle" as const
            : "running" as const,
        lastPrompt: promptStorage.summary,
        lastPromptHash: promptStorage.hash,
        lastPromptLength: promptStorage.length,
        lastDispatchMode: injectResult.dispatchMode,
        lastStatusBeforeDispatch: injectResult.statusBefore,
      }
    })

    await this.saveSessions(workflowId, next)
  }

  async archiveIrrelevantSessions(workflowId: string, phase: Phase): Promise<void> {
    const sessions = await this.loadSessions(workflowId)
    const next = sessions.map((session) => ({
      ...session,
      archived: session.phase !== phase,
    }))
    await this.saveSessions(workflowId, next)
  }

  async getStoredSession(workflowId: string, sessionId: string): Promise<SessionDescriptor | null> {
    const sessions = await this.loadSessions(workflowId)
    return sessions.find((session) => session.sessionId === sessionId) ?? null
  }

  async listStoredSessions(workflowId: string): Promise<SessionDescriptor[]> {
    return this.loadSessions(workflowId)
  }

  async updateStoredSession(workflowId: string, sessionId: string, patch: Partial<SessionDescriptor>): Promise<void> {
    const sessions = await this.loadSessions(workflowId)
    const next = sessions.map((session) => session.sessionId === sessionId ? { ...session, ...patch } : session)
    await this.saveSessions(workflowId, next)
  }

  async getSessionStatus(sessionId: string): Promise<"running" | "idle" | "failed" | "missing"> {
    return this.sessionClient.getSessionStatus(sessionId)
  }

  async getLatestAssistantText(sessionId: string): Promise<string | null> {
    return this.sessionClient.getLatestAssistantText(sessionId)
  }

  async *streamEvents(session: SessionDescriptor, signal?: AbortSignal): AsyncIterable<SessionEvent> {
    for await (const event of this.sessionClient.streamEvents(session.sessionId, signal)) {
      yield event
    }
  }

  private async loadSessions(workflowId: string): Promise<SessionDescriptor[]> {
    const data = await readJsonFile<SessionStateFile>(this.workspace.sessionsFile(workflowId))
    return data?.sessions ?? []
  }

  private async saveSessions(workflowId: string, sessions: SessionDescriptor[]): Promise<void> {
    await writeJsonFile(this.workspace.sessionsFile(workflowId), { sessions })
  }
}
