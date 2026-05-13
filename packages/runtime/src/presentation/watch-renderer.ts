import type { HumanActionRecord } from "../../../core/src/human-actions/human-action-record"
import type { WorkflowRuntimeState } from "../../../core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../../../core/src/state/workflow-state"
import type { WorkflowEventRecord } from "../events/workflow-event-store"
import { renderHumanActionBlock } from "./human-action-renderer"

export function renderWatchFrame(args: {
  workflow: WorkflowState
  runtime: WorkflowRuntimeState | null
  humanAction: HumanActionRecord | null
  recentEvents: WorkflowEventRecord[]
  attached: boolean
  modeLabel?: string
}): string {
  const { workflow, runtime, humanAction, recentEvents, attached, modeLabel = "Autopilot" } = args
  const lines = [
    `Mode: ${modeLabel}`,
    `Attached: ${attached ? "yes" : "no"}`,
    renderHumanActionBlock({ workflow, runtime, humanAction }),
  ]

  if (recentEvents.length > 0) {
    lines.push("")
    lines.push("Recent events:")
    for (const event of recentEvents.slice(-5)) {
      if (event.type === "artifact.repair_dispatched") {
        lines.push(`- ${event.at} ${event.type} (${String(event.payload?.phase ?? "unknown")})`)
        continue
      }
      if (event.type === "artifact.repair_blocked") {
        lines.push(`- ${event.at} ${event.type} (${String(event.payload?.phase ?? "unknown")})`)
        continue
      }
      lines.push(`- ${event.at} ${event.type}`)
    }
  }

  return lines.join("\n")
}
