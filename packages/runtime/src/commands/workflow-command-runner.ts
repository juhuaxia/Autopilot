import type { createHarness } from "../bootstrap/create-harness"
import type { WorkflowEventRecord } from "../events/workflow-event-store"

export type WorkflowChannelCommand =
  | "workflow-open"
  | "workflow-attach"
  | "workflow-status"
  | "workflow-answer"
  | "workflow-approve"
  | "workflow-resume"
  | "workflow-back"

export interface WorkflowCommandResult {
  ok: boolean
  output: string
  events: WorkflowEventRecord[]
}

type Harness = Awaited<ReturnType<typeof createHarness>>

export interface WorkflowCommandRunner {
  run(args: {
    harness: Harness
    command: WorkflowChannelCommand
    workflowId: string
    payload?: string
    foregroundSessionId?: string
  }): Promise<WorkflowCommandResult>
}
