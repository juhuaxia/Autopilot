import type { WorkflowPresetMode } from "../../../core/src/state/workflow-runtime-state"

export const DEFAULT_MAX_ITERATIONS = 10
export const AP_GOAL_MAX_ITERATIONS = 30

export function getMaxIterationsForPreset(presetMode?: WorkflowPresetMode | null): number {
  return presetMode === "ap-goal" ? AP_GOAL_MAX_ITERATIONS : DEFAULT_MAX_ITERATIONS
}

export function normalizeMaxIterationsForPreset(current: number, presetMode?: WorkflowPresetMode | null): number {
  const target = getMaxIterationsForPreset(presetMode)
  return current >= target ? current : target
}
