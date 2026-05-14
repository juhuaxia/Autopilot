import type { Phase } from "../state/phase"
import type { BlockedDecision } from "../state/workflow-runtime-state"
import type { Question } from "./question"

export type HumanActionType =
  | "need_answers"
  | "need_approval"
  | "blocked"
  | "done"

export interface HumanAction {
  type: HumanActionType
  workflowId: string
  phase: Phase
  reason: string
  required: boolean
  questions?: Question[]
  summary?: string
  allowedDecisions?: BlockedDecision[]
  createdAt: string
}
