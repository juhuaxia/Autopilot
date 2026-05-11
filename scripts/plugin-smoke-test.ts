import { pathToFileURL } from "node:url"
import { resolve } from "node:path"

type PluginLike = {
  tool?: Record<string, { execute?: (args: Record<string, string>) => Promise<string> }>
  workflow?: {
    name?: string
    commands?: Array<{ name: string }>
  }
  workflowCommands?: Array<{ name: string }>
}

async function loadModule(modulePath: string): Promise<unknown> {
  return import(pathToFileURL(resolve(modulePath)).href)
}

function assertPluginShape(plugin: PluginLike): void {
  if (!plugin.workflow) {
    throw new Error("Plugin did not expose a workflow field")
  }
  if (plugin.workflow.name !== "autopilot") {
    throw new Error(`Unexpected workflow plugin name: ${plugin.workflow.name}`)
  }

  const commands = plugin.workflowCommands ?? plugin.workflow.commands ?? []
  const required = [
    "workflow-open",
    "workflow-attach",
    "workflow-status",
    "workflow-answer",
    "workflow-approve",
    "workflow-resume",
    "workflow-back",
  ]

  for (const command of required) {
    if (!commands.some((item) => item.name === command)) {
      throw new Error(`Missing workflow command in plugin shape: ${command}`)
    }
  }

  const requiredTools = [
    "workflow_channel",
    "workflow_open",
    "workflow_attach",
    "workflow_status",
    "workflow_answer",
    "workflow_approve",
    "workflow_resume",
    "workflow_back",
  ]

  for (const toolName of requiredTools) {
    if (typeof plugin.tool?.[toolName]?.execute !== "function") {
      throw new Error(`Missing workflow tool in plugin shape: ${toolName}`)
    }
  }
}

async function verifyModule(label: string, modulePath: string): Promise<void> {
  const mod = await loadModule(modulePath)
  if (!mod || typeof mod !== "object") {
    throw new Error(`${label}: module import did not return an object`) }

  const candidate = mod as {
    default?: (input: { directory: string; serverUrl?: string }) => Promise<PluginLike>
  }

  if (typeof candidate.default !== "function") {
    throw new Error(`${label}: default export is not a function`) }

  const plugin = await candidate.default({
    directory: process.cwd(),
  })

  assertPluginShape(plugin)
  const openTool = plugin.tool?.workflow_open
  if (!openTool || typeof openTool.execute !== "function") {
    throw new Error(`${label}: workflow_open tool is not callable`)
  }

  const output = await openTool.execute({ workflowId: "wf-smoke" })
  const looksLikeWorkflowBlock = output.includes("Workflow:")
  const looksLikeClarification = output.includes("你想怎么处理？") || output.includes("直接启动 workflow")
  if (!looksLikeWorkflowBlock && !looksLikeClarification) {
    throw new Error(`${label}: workflow output is neither a workflow block nor a clarification response`)
  }

  const backTool = plugin.tool?.workflow_back
  if (!backTool || typeof backTool.execute !== "function") {
    throw new Error(`${label}: workflow_back tool is not callable`)
  }
  await backTool.execute({ workflowId: "wf-smoke" })

  console.log(`✅ ${label}: plugin shape is valid`)
}

async function main(): Promise<void> {
  await verifyModule("source plugin", "./plugin.ts")
  await verifyModule("built plugin", "./dist/plugin.js")
}

void main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
