import type { Phase } from "../../../core/src/state/phase"
import type { RelevantSessionState } from "../../../core/src/transitions/phase-transition"
import type { SessionEvent } from "../../../adapters/opencode/src/opencode-session-client"

export interface SessionDescriptor {
  sessionId: string
  workflowId: string
  phase: Phase
  createdAt: string
  archived?: boolean
  isForegroundPreferred?: boolean
  status: "running" | "idle" | "failed"
  title?: string
  lastPrompt?: string
  lastDispatchMode?: string
  lastStatusBeforeDispatch?: "running" | "idle" | "failed" | "missing"
}

export interface SessionCoordinator {
  getRelevantSession(workflowId: string): Promise<RelevantSessionState>
  ensureSession(workflowId: string, phase: Phase, preferredSessionId?: string | null): Promise<string>
  inject(workflowId: string, sessionId: string, prompt: string): Promise<void>
  archiveIrrelevantSessions(workflowId: string, phase: Phase): Promise<void>
  getStoredSession(workflowId: string, sessionId: string): Promise<SessionDescriptor | null>
  streamEvents(session: SessionDescriptor): AsyncIterable<SessionEvent>
}
