import type { HumanAction } from "../human-actions/human-action"
import type { Phase } from "../state/phase"

export type TransitionAction =
  | { type: "dispatch"; phase: Phase; reason: string }
  | { type: "wait_human"; action: HumanAction }
  | { type: "advance_phase"; nextPhase: Phase; reason: string }
  | { type: "recover"; reason: string }
  | { type: "stop"; reason: string }
