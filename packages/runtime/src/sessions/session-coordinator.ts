import type { Phase } from "../../../core/src/state/phase"
import type { RelevantSessionState } from "../../../core/src/transitions/phase-transition"
import type { SessionEvent } from "../../../adapters/opencode/src/opencode-session-client"

export interface SessionDescriptor {
  sessionId: string
  workflowId: string
  phase: Phase
  createdAt: string
  kind?: "main" | "reviewer"
  roleName?: string
  archived?: boolean
  isForegroundPreferred?: boolean
  status: "running" | "idle" | "failed"
  title?: string
  lastPrompt?: string
  lastPromptHash?: string
  lastPromptLength?: number
  lastDispatchMode?: string
  lastStatusBeforeDispatch?: "running" | "idle" | "failed" | "missing"
  lastAssistantSummaryHash?: string
}

export interface SessionCoordinator {
  getRelevantSession(workflowId: string): Promise<RelevantSessionState>
  ensureSession(workflowId: string, phase: Phase, preferredSessionId?: string | null): Promise<string>
  createSession(
    workflowId: string,
    phase: Phase,
    title: string,
    options?: { kind?: "main" | "reviewer"; roleName?: string },
  ): Promise<string>
  inject(workflowId: string, sessionId: string, prompt: string): Promise<void>
  archiveIrrelevantSessions(workflowId: string, phase: Phase): Promise<void>
  getStoredSession(workflowId: string, sessionId: string): Promise<SessionDescriptor | null>
  listStoredSessions(workflowId: string): Promise<SessionDescriptor[]>
  updateStoredSession(workflowId: string, sessionId: string, patch: Partial<SessionDescriptor>): Promise<void>
  getSessionStatus(sessionId: string): Promise<"running" | "idle" | "failed" | "missing">
  getLatestAssistantText(sessionId: string): Promise<string | null>
  streamEvents(session: SessionDescriptor, signal?: AbortSignal): AsyncIterable<SessionEvent>
}
