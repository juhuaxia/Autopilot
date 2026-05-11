import { describe, expect, it } from "bun:test"
import type { HumanActionRecord } from "../packages/core/src/human-actions/human-action-record"
import type { WorkflowRuntimeState } from "../packages/core/src/state/workflow-runtime-state"
import type { WorkflowState } from "../packages/core/src/state/workflow-state"
import { renderWatchFrame } from "../packages/runtime/src/presentation/watch-renderer"

describe("watch renderer", () => {
  it("renders recent workflow events alongside state block", () => {
    const workflow: WorkflowState = {
      workflowId: "wf-watch",
      phase: "develop",
      status: "in_progress",
      approved: true,
      iteration: 1,
      maxIterations: 3,
      blockReason: null,
      activeSessionId: "session-1",
      phaseEnteredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const runtime: WorkflowRuntimeState = {
      workflowId: workflow.workflowId,
      recoveryState: "idle",
      consecutiveFailures: 0,
    }
    const humanAction: HumanActionRecord | null = null

    const output = renderWatchFrame({
      workflow,
      runtime,
      humanAction,
      recentEvents: [
        { workflowId: workflow.workflowId, type: "phase.changed", at: "2026-01-01T00:00:00.000Z" },
        { workflowId: workflow.workflowId, type: "session.dispatched", at: "2026-01-01T00:00:01.000Z" },
      ],
      attached: true,
    })

    expect(output).toContain("Attached: yes")
    expect(output).toContain("Recent events:")
    expect(output).toContain("phase.changed")
    expect(output).toContain("session.dispatched")
  })
})
