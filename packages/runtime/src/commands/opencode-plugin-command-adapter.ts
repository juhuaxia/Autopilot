import type { WorkflowChannelCommand, WorkflowCommandRunner } from "./workflow-command-runner"

export interface WorkflowPluginCommandRequest {
  command: WorkflowChannelCommand
  workflowId: string
  payload?: string
  foregroundSessionId?: string
}

export interface WorkflowPluginCommandResponse {
  ok: boolean
  text: string
}

export interface WorkflowPluginCommandAdapter {
  execute(request: WorkflowPluginCommandRequest): Promise<WorkflowPluginCommandResponse>
}

export class DefaultWorkflowPluginCommandAdapter implements WorkflowPluginCommandAdapter {
  constructor(
    private readonly runner: WorkflowCommandRunner,
    private readonly harnessFactory: () => Promise<Awaited<ReturnType<typeof import("../bootstrap/create-harness").createHarness>>>,
  ) {}

  async execute(request: WorkflowPluginCommandRequest): Promise<WorkflowPluginCommandResponse> {
    const harness = await this.harnessFactory()
    const result = await this.runner.run({
      harness,
      command: request.command,
      workflowId: request.workflowId,
      ...(request.payload !== undefined ? { payload: request.payload } : {}),
      ...(request.foregroundSessionId ? { foregroundSessionId: request.foregroundSessionId } : {}),
    })

    return {
      ok: result.ok,
      text: result.output,
    }
  }
}
