import { join } from "node:path"
import { createHarness } from "../packages/runtime/src/bootstrap/create-harness"
import { initializeWorkflow } from "../packages/runtime/src/bootstrap/initialize-workflow"
import { DefaultWorkflowCommandRunner } from "../packages/runtime/src/commands/default-workflow-command-runner"
import { formatWorkflowDoctorResult, formatWorkflowInstallResult } from "../packages/runtime/src/diagnostics/workflow-diagnostics-format"
import { runWorkflowDoctor } from "../packages/runtime/src/diagnostics/workflow-doctor"
import { runWorkflowInstall } from "../packages/runtime/src/install/workflow-installer"
import { renderHumanActionBlock } from "../packages/runtime/src/presentation/human-action-renderer"
import { renderWatchFrame } from "../packages/runtime/src/presentation/watch-renderer"
import { homedir } from "node:os"

const WORKFLOW_COMMANDS = new Set([
  "workflow-open",
  "workflow-attach",
  "workflow-status",
  "workflow-answer",
  "workflow-approve",
  "workflow-resume",
  "workflow-back",
  "workflow-doctor",
  "workflow-install",
])

function normalizeCommand(command: string): string {
  if (!WORKFLOW_COMMANDS.has(command)) {
    return command
  }

  switch (command) {
    case "workflow-open":
      return "start"
    case "workflow-attach":
      return "attach"
    case "workflow-status":
      return "status"
    case "workflow-answer":
      return "answer"
    case "workflow-approve":
      return "approve"
    case "workflow-resume":
      return "resume"
    case "workflow-back":
      return "back"
    case "workflow-doctor":
      return "doctor"
    case "workflow-install":
      return "install"
    default:
      return command
  }
}

async function printSnapshot(harness: Awaited<ReturnType<typeof createHarness>>, workflowId: string): Promise<void> {
  const workflow = await harness.stateStore.getWorkflow(workflowId)
  const runtime = await harness.stateStore.getRuntime(workflowId)
  const humanAction = await harness.humanActionStore.getCurrent(workflowId)
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`)
  }
  console.log(renderHumanActionBlock({ workflow, runtime, humanAction }))
}

async function watchWorkflow(harness: Awaited<ReturnType<typeof createHarness>>, workflowId: string): Promise<void> {
  await harness.attachService.attach(workflowId)
  let lastFingerprint = ""

  while (true) {
    const workflow = await harness.stateStore.getWorkflow(workflowId)
    const runtime = await harness.stateStore.getRuntime(workflowId)
    const humanAction = await harness.humanActionStore.getCurrent(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const events = await harness.eventStore.list(workflowId)
    const fingerprint = JSON.stringify({
      workflow,
      runtime,
      humanAction,
      eventCount: events.length,
    })

    if (fingerprint !== lastFingerprint) {
      console.clear()
      console.log(renderWatchFrame({
        workflow,
        runtime,
        humanAction,
        recentEvents: events,
        attached: true,
        modeLabel: "Autopilot",
      }))
      lastFingerprint = fingerprint
    }

    if (workflow.phase === "done" || workflow.phase === "blocked") {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

async function main(): Promise<void> {
  const [, , command, workflowId, payload] = process.argv
  const normalizedCommand = command ? normalizeCommand(command) : command
  const baseDir = join(process.cwd(), ".workflow-harness")
  const harnessOptions = {
    ...(process.env.OPENCODE_BASE_URL ? { opencodeBaseUrl: process.env.OPENCODE_BASE_URL } : {}),
    ...(process.env.OPENCODE_SERVER_PASSWORD
      ? { opencodePassword: process.env.OPENCODE_SERVER_PASSWORD }
      : {}),
  }
  const harness = await createHarness(baseDir, harnessOptions)
  const commandRunner = new DefaultWorkflowCommandRunner()

  if (!normalizedCommand) {
    throw new Error("Usage: bun run cli <start|status|watch|attach|answer|approve|resume|doctor|install|workflow-open|workflow-attach|workflow-status|workflow-answer|workflow-approve|workflow-resume|workflow-back|workflow-doctor|workflow-install> <workflowId> [payload]")
  }

  if (normalizedCommand === "install") {
    const result = await runWorkflowInstall({
      cwd: process.cwd(),
      homeDir: homedir(),
    })
    console.log(formatWorkflowInstallResult(result))
    return
  }

  if (normalizedCommand === "doctor") {
    const result = await runWorkflowDoctor(harness.workspace)
    console.log(formatWorkflowDoctorResult(result))
    return
  }

  if (!workflowId) {
    throw new Error("Usage: bun run cli <start|status|watch|attach|answer|approve|resume|doctor|workflow-open|workflow-attach|workflow-status|workflow-answer|workflow-approve|workflow-resume|workflow-back|workflow-doctor|workflow-install> <workflowId> [payload]")
  }

  if (normalizedCommand === "start") {
    await initializeWorkflow({
      workflowId,
      stateStore: harness.stateStore,
      artifactEvaluator: harness.artifactEvaluator,
    })
    await harness.sessionActivityMonitor.start(workflowId)
    await harness.tickScheduler.requestTick(workflowId, "workflow started")
  } else if (normalizedCommand === "status") {
    await printSnapshot(harness, workflowId)
    return
  } else if (normalizedCommand === "watch") {
    await watchWorkflow(harness, workflowId)
    return
  } else if (normalizedCommand === "attach") {
    await watchWorkflow(harness, workflowId)
    return
  } else if (WORKFLOW_COMMANDS.has(command!)) {
    const commandArgs = {
      harness,
      command: command as Parameters<DefaultWorkflowCommandRunner["run"]>[0]["command"],
      workflowId,
      ...(payload !== undefined ? { payload } : {}),
    }
    const result = await commandRunner.run(commandArgs)
    console.log(result.output)
    return
  } else if (normalizedCommand === "back") {
    console.log(`Returned from workflow channel for ${workflowId}. Your workflow continues and can be re-attached later.`)
    return
  } else if (normalizedCommand === "answer") {
    const answers = payload ? (JSON.parse(payload) as Record<string, string>) : {}
    await harness.humanActionService.answer(workflowId, answers)
  } else if (normalizedCommand === "approve") {
    await harness.humanActionService.approve(workflowId)
  } else if (normalizedCommand === "resume") {
    await harness.humanActionService.resume(workflowId)
  } else {
    throw new Error(`Unknown command: ${command}`)
  }

  await printSnapshot(harness, workflowId)
}

void main()
