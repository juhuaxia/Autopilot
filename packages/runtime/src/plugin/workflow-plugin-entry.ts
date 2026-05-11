import type { WorkflowPluginCommandDefinition } from "../commands/create-opencode-workflow-commands"
import { createOpencodeWorkflowCommands } from "../commands/create-opencode-workflow-commands"
import { DefaultWorkflowCommandRunner } from "../commands/default-workflow-command-runner"
import { DefaultWorkflowPluginCommandAdapter } from "../commands/opencode-plugin-command-adapter"
import { createHarness } from "../bootstrap/create-harness"
import { runWorkflowDoctor } from "../diagnostics/workflow-doctor"
import { runWorkflowInstall } from "../install/workflow-installer"
import {
  SdkOpencodeSessionClient,
  type PluginSdkClient,
} from "../../../adapters/opencode/src/opencode-session-client"
import type { Phase, WorkflowStatus } from "../../../core/src/state/phase"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

export interface WorkflowPluginInputLike {
  directory: string
  serverUrl?: string
  client?: PluginSdkClient
}

type PluginEventInput = {
  event: {
    type: string
    properties?: Record<string, unknown>
  }
}

type NativeAgentConfig = {
  mode: "primary" | "subagent" | "all"
  description: string
  model: string
  prompt: string
  tools: Record<string, boolean>
}

type NativeHostConfig = {
  agent?: Record<string, NativeAgentConfig>
}

type HostTodoItem = {
  id: string
  title?: string
  completed?: boolean
}

type WorkflowToolArgs = {
  command: WorkflowPluginCommandDefinition["name"]
  workflowId: string
  payload?: string
}

type WorkflowToolContext = {
  sessionID?: string
}

const workflowIdSchema = z.string().min(1).describe("Workflow identifier")

export interface WorkflowPluginEntry {
  name: string
  commands: WorkflowPluginCommandDefinition[]
}

type WorkflowPrimaryAgentMetadata = {
  name: string
  mode: "primary"
  description: string
  model: string
  tools: Record<string, boolean>
  promptFile: string
  manifestFile: string
}

export interface WorkflowPluginEntryOptions {
  baseDir: string
  harnessPromise?: Promise<Awaited<ReturnType<typeof createHarness>>>
  opencodeBaseUrl?: string
  opencodePassword?: string
  sessionClient?: Awaited<ReturnType<typeof createHarness>>["sessionClient"]
}

const WORKFLOW_PRIMARY_AGENT_PROMPT = `You are the workflow execution agent.

Responsibilities:
- Act as the main entry agent for the workflow lifecycle.
- Use workflow_open to start a workflow when none exists.
- Prefer workflow_attach to continue an existing workflow. Use workflow_status mainly when you need a fresh read without driving continuation.
- Follow runtime output strictly. If Recommended tool / payload is present, use it instead of inventing a phase jump.
- Use workflow_answer, workflow_approve, and workflow_resume only when the runtime asks for human action.
- If workflow_open returns a clarification question, STOP and ask the user that question. Do not call workflow_status or other workflow tools until the user answers.
- When a workflow tool returns a structured workflow block, preserve and show the full block to the user. Do not compress it into a one-line summary unless the user explicitly asks for a summary.
- If the workflow is in progress and the runtime output recommends workflow_attach, continue with workflow_attach instead of stopping at workflow_status.

Hard rules:
- Never skip phases manually.
- Never assume you can jump directly to develop/review/test.
- The runtime state machine is the only authority for phase progression.
- If the user provides natural language only, keep it as-is and let the workflow runtime + downstream AI refinement handle understanding and document selection.
`

const WORKFLOW_PRIMARY_AGENT_DESCRIPTION = "Primary workflow agent that drives refine->plan->develop->review->test via workflow tools"
const WORKFLOW_PRIMARY_AGENT_MODEL = "ppchat-codex/gpt-5.4"

function buildPrimaryAgentMetadata(baseDir: string): WorkflowPrimaryAgentMetadata {
  return {
    name: "workflow",
    mode: "primary",
    description: WORKFLOW_PRIMARY_AGENT_DESCRIPTION,
    model: WORKFLOW_PRIMARY_AGENT_MODEL,
    tools: {
      workflow_open: true,
      workflow_attach: true,
      workflow_status: true,
      workflow_answer: true,
      workflow_approve: true,
      workflow_resume: true,
      workflow_back: true,
    },
    promptFile: `${baseDir}/workflow-primary-agent.prompt.md`,
    manifestFile: `${baseDir}/workflow-primary-agent.manifest.json`,
  }
}

function buildWorkflowTodos(phase: Phase, status: WorkflowStatus): Array<{ title: string; completed: boolean }> {
  const phases: Array<{ key: Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test" | "done">; title: string }> = [
    { key: "spec_refinement", title: "Workflow / Refinement" },
    { key: "plan", title: "Workflow / Plan" },
    { key: "develop", title: "Workflow / Develop" },
    { key: "review", title: "Workflow / Review" },
    { key: "test", title: "Workflow / Test" },
    { key: "done", title: "Workflow / Done" },
  ]
  const currentIndex = phases.findIndex((item) => item.key === phase || (phase === "blocked" && item.key === "test"))
  return phases.map((item, index) => ({
    title: item.title,
    completed: phase === "done"
      ? true
      : currentIndex === -1
        ? false
        : index < currentIndex,
  }))
    .map((item) => ({
      ...item,
      completed: status === "completed" && item.title === "Workflow / Done" ? true : item.completed,
    }))
}

async function syncHostTodos(args: {
  baseDir: string
  workflowId: string
  client?: WorkflowPluginInputLike["client"]
}): Promise<void> {
  const todoClient = args.client?.session?.todo
  if (!todoClient?.list || !todoClient.create || !todoClient.update) {
    return
  }

  const stateFile = join(args.baseDir, "workflows", args.workflowId, "workflow-state.json")
  let workflow: { phase?: Phase; status?: WorkflowStatus; activeSessionId?: string | null; workflowId?: string } | null = null
  try {
    workflow = JSON.parse(await readFile(stateFile, "utf8")) as { phase?: Phase; status?: WorkflowStatus; activeSessionId?: string | null; workflowId?: string }
  } catch {
    return
  }

  if (!workflow?.activeSessionId || !workflow.phase || !workflow.status) {
    return
  }

  const desired = buildWorkflowTodos(workflow.phase, workflow.status)
  const existingResponse = await todoClient.list({ path: { id: workflow.activeSessionId } }) as { data?: HostTodoItem[] }
  const existing = existingResponse.data ?? []

  for (const todo of desired) {
    const current = existing.find((item) => item.title === todo.title)
    if (!current) {
      await todoClient.create({
        path: { id: workflow.activeSessionId },
        body: {
          title: todo.title,
          content: `workflowId=${workflow.workflowId}; phase=${workflow.phase}; status=${workflow.status}`,
        },
      })
      continue
    }

    if ((current.completed ?? false) !== todo.completed) {
      await todoClient.update({
        path: { id: workflow.activeSessionId, todoId: current.id },
        body: {
          completed: todo.completed,
          content: `workflowId=${workflow.workflowId}; phase=${workflow.phase}; status=${workflow.status}`,
        },
      })
    }
  }
}

async function findWorkflowBySessionId(args: {
  baseDir: string
  sessionId: string
}): Promise<{ workflowId: string; phase?: Phase; status?: WorkflowStatus } | null> {
  const harness = await createHarness(args.baseDir)
  const workflows = await harness.stateStore.listWorkflows?.()
  const match = workflows?.find((workflow) => workflow.activeSessionId === args.sessionId)
  if (!match) {
    return null
  }
  return {
    workflowId: match.workflowId,
    phase: match.phase,
    status: match.status,
  }
}

export function createWorkflowPluginEntry(options: WorkflowPluginEntryOptions): WorkflowPluginEntry {
  const harnessPromise = options.harnessPromise
    ?? createHarness(options.baseDir, {
      ...(options.sessionClient ? { sessionClient: options.sessionClient } : {}),
      ...(options.opencodeBaseUrl ? { opencodeBaseUrl: options.opencodeBaseUrl } : {}),
      ...(options.opencodePassword ? { opencodePassword: options.opencodePassword } : {}),
    })
  const adapter = new DefaultWorkflowPluginCommandAdapter(
    new DefaultWorkflowCommandRunner(),
    () => harnessPromise,
  )

  return {
    name: "autopilot",
    commands: createOpencodeWorkflowCommands(adapter),
  }
}

export async function workflowPlugin(input: WorkflowPluginInputLike) {
  const baseDir = `${input.directory}/.workflow-harness`
  const sdkSessionClient = input.client
    ? new SdkOpencodeSessionClient(input.client)
    : undefined
  const harnessPromise = createHarness(baseDir, {
    ...(sdkSessionClient ? { sessionClient: sdkSessionClient } : {}),
    ...(input.serverUrl ? { opencodeBaseUrl: input.serverUrl } : {}),
  })
  const entry = createWorkflowPluginEntry({
    baseDir,
    harnessPromise,
  })
  const commandNames = entry.commands.map((command) => command.name)
  const loadMessage = `Autopilot plugin loaded (${commandNames.length} commands)`
  const commandMap = new Map(entry.commands.map((command) => [command.name, command]))
  const primaryAgent = buildPrimaryAgentMetadata(baseDir)

  const invokeCommand = async (commandName: WorkflowPluginCommandDefinition["name"], workflowId: string, payload?: string, foregroundSessionId?: string) => {
    const command = commandMap.get(commandName)
    if (!command) {
      return `Unknown workflow command: ${commandName}`
    }

    const result = await command.execute({
      workflowId,
      ...(payload !== undefined ? { payload } : {}),
      ...(foregroundSessionId ? { foregroundSessionId } : {}),
    })
    await syncHostTodos({
      baseDir,
      workflowId,
      ...(input.client ? { client: input.client } : {}),
    })
    return result
  }

  console.log(`[autopilot] ${loadMessage}`)
  await mkdir(baseDir, { recursive: true })
  await writeFile(primaryAgent.promptFile, `${WORKFLOW_PRIMARY_AGENT_PROMPT}\n`, "utf8")
  await writeFile(primaryAgent.manifestFile, `${JSON.stringify(primaryAgent, null, 2)}\n`, "utf8")
  await writeFile(
    `${baseDir}/plugin-load.json`,
    `${JSON.stringify({
      ok: true,
      name: entry.name,
      loadedAt: new Date().toISOString(),
      commands: commandNames,
    }, null, 2)}\n`,
    "utf8",
  )

  return {
    config: async (cfg?: NativeHostConfig) => {
      if (!cfg) {
        return
      }
      cfg.agent ??= {}
      cfg.agent[primaryAgent.name] = {
        mode: primaryAgent.mode,
        description: primaryAgent.description,
        model: primaryAgent.model,
        prompt: WORKFLOW_PRIMARY_AGENT_PROMPT,
        tools: primaryAgent.tools,
      }
    },
    healthcheck: async () => ({
      ok: true,
      name: entry.name,
      commands: commandNames,
      primaryAgent,
    }),
    event: async (inputEvent: PluginEventInput) => {
      const sessionId = typeof inputEvent.event.properties?.sessionID === "string"
        ? inputEvent.event.properties.sessionID
        : undefined
      if (!sessionId) {
        return
      }

      const workflow = await findWorkflowBySessionId({
        baseDir,
        sessionId,
      })
      if (!workflow) {
        return
      }

      const harness = await harnessPromise

      await syncHostTodos({
        baseDir,
        workflowId: workflow.workflowId,
        ...(input.client ? { client: input.client } : {}),
      })

      if (inputEvent.event.type === "session.idle") {
        await harness.tickScheduler.requestTick(workflow.workflowId, "plugin observed session idle")
      }

      if (!input.client?.tui?.showToast) {
        return
      }

      if (inputEvent.event.type === "session.idle") {
        await input.client.tui.showToast({
          body: {
            message: `Workflow ${workflow.workflowId}: ${workflow.phase ?? "unknown"} / ${workflow.status ?? "unknown"}`,
            variant: "info",
          },
        })
      }

      if (inputEvent.event.type === "session.error") {
        await input.client.tui.showToast({
          body: {
            message: `Workflow ${workflow.workflowId} encountered a session error`,
            variant: "error",
          },
        })
      }
    },
    tool: {
      workflow_channel: {
        description: "Run workflow channel commands inside the workflow harness.",
        args: {
          command: z.enum(commandNames as [WorkflowPluginCommandDefinition["name"], ...WorkflowPluginCommandDefinition["name"][]])
            .describe("Workflow channel command to execute"),
          workflowId: workflowIdSchema,
          payload: z.string().optional().describe("Optional JSON/string payload for answer-like commands"),
        },
        execute: async (args: WorkflowToolArgs, context?: WorkflowToolContext) => {
          return invokeCommand(args.command, args.workflowId, args.payload, context?.sessionID)
        },
      },
      workflow_open: {
        description: "Open or initialize a workflow channel and attach to it.",
        args: {
          workflowId: workflowIdSchema,
          payload: z.string().optional().describe("Initial request. Supports plain text or JSON: { prompt, docPaths[], projectContext }"),
        },
        execute: async (args: { workflowId: string; payload?: string }, context?: WorkflowToolContext) => invokeCommand("workflow-open", args.workflowId, args.payload, context?.sessionID),
      },
      workflow_attach: {
        description: "Attach to an existing workflow channel.",
        args: {
          workflowId: workflowIdSchema,
        },
        execute: async (args: { workflowId: string }, context?: WorkflowToolContext) => invokeCommand("workflow-attach", args.workflowId, undefined, context?.sessionID),
      },
      workflow_status: {
        description: "Render the current workflow status block.",
        args: {
          workflowId: workflowIdSchema,
        },
        execute: async (args: { workflowId: string }, context?: WorkflowToolContext) => invokeCommand("workflow-status", args.workflowId, undefined, context?.sessionID),
      },
      workflow_answer: {
        description: "Answer workflow clarification questions.",
        args: {
          workflowId: workflowIdSchema,
          payload: z.string().describe("JSON string payload for question answers"),
        },
        execute: async (args: { workflowId: string; payload: string }, context?: WorkflowToolContext) => invokeCommand("workflow-answer", args.workflowId, args.payload, context?.sessionID),
      },
      workflow_approve: {
        description: "Approve the current workflow plan or decision.",
        args: {
          workflowId: workflowIdSchema,
        },
        execute: async (args: { workflowId: string }, context?: WorkflowToolContext) => invokeCommand("workflow-approve", args.workflowId, undefined, context?.sessionID),
      },
      workflow_resume: {
        description: "Resume a blocked workflow.",
        args: {
          workflowId: workflowIdSchema,
        },
        execute: async (args: { workflowId: string }, context?: WorkflowToolContext) => invokeCommand("workflow-resume", args.workflowId, undefined, context?.sessionID),
      },
      workflow_back: {
        description: "Leave the workflow channel without stopping the workflow.",
        args: {
          workflowId: workflowIdSchema,
        },
        execute: async (args: { workflowId: string }, context?: WorkflowToolContext) => invokeCommand("workflow-back", args.workflowId, undefined, context?.sessionID),
      },
      workflow_doctor: {
        description: "Run workflow configuration and skill self-check diagnostics.",
        args: {},
        execute: async () => {
          const harness = await harnessPromise
          return JSON.stringify(await runWorkflowDoctor(harness.workspace), null, 2)
        },
      },
      workflow_install: {
        description: "Generate autopilot.json and safely register the plugin in OpenCode config.",
        args: {},
        execute: async () => {
          return JSON.stringify(await runWorkflowInstall({
            cwd: input.directory,
            homeDir: homedir(),
          }), null, 2)
        },
      },
    },
    workflowCommands: entry.commands,
    workflow: {
      name: entry.name,
      commands: entry.commands,
      primaryAgent,
    },
  }
}

export default workflowPlugin
