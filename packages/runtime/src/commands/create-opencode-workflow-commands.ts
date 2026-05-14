import type { WorkflowPluginCommandAdapter } from "./opencode-plugin-command-adapter"
import type { WorkflowChannelCommand } from "./workflow-command-runner"

export interface WorkflowPluginCommandDefinition {
  name: WorkflowChannelCommand
  description: string
  execute(args: { workflowId: string; payload?: string; foregroundSessionId?: string }): Promise<string>
}

const COMMAND_DESCRIPTIONS: Record<WorkflowChannelCommand, string> = {
  "workflow-open": "Open or initialize a workflow channel and attach to it.",
  "workflow-attach": "Attach to an existing workflow channel.",
  "workflow-status": "Render the current workflow status block.",
  "workflow-answer": "Answer workflow clarification questions.",
  "workflow-approve": "Approve the current workflow plan or decision.",
  "workflow-resume": "Resume a blocked workflow.",
  "workflow-resync": "Re-sync a review/test workflow with out-of-band code edits and rerun the current phase.",
  "workflow-back": "Leave the workflow channel without stopping the workflow.",
}

export function createOpencodeWorkflowCommands(
  adapter: WorkflowPluginCommandAdapter,
): WorkflowPluginCommandDefinition[] {
  return (Object.keys(COMMAND_DESCRIPTIONS) as WorkflowChannelCommand[]).map((name) => ({
    name,
    description: COMMAND_DESCRIPTIONS[name],
    async execute(args: { workflowId: string; payload?: string; foregroundSessionId?: string }): Promise<string> {
      const response = await adapter.execute({
        command: name,
        workflowId: args.workflowId,
        ...(args.payload !== undefined ? { payload: args.payload } : {}),
        ...(args.foregroundSessionId ? { foregroundSessionId: args.foregroundSessionId } : {}),
      })
      return response.text
    },
  }))
}
