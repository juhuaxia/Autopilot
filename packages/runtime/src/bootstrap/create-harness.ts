import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  HttpOpencodeSessionClient,
  InMemoryOpencodeSessionClient,
  type OpencodeSessionClient,
} from "../../../adapters/opencode/src/opencode-session-client"
import { DefaultPhaseTransition } from "../../../core/src/transitions/default-phase-transition"
import { FileSystemArtifactEvaluator } from "../artifacts/file-system-artifact-evaluator"
import { DefaultAttachService } from "../attach/attach-service"
import { buildSkillRegistryWithWarnings } from "../config/skill-registry"
import { ensureAutopilotConfigFile, resolveWorkflowConfig, AUTOPILOT_CONFIG_FILENAME } from "../config/workflow-config"
import { DefaultWorkflowEngine } from "../engine/default-workflow-engine"
import { FileSystemWorkflowEventStore } from "../events/file-system-workflow-event-store"
import { BasicRecoveryClassifier } from "../recovery/basic-recovery-classifier"
import { ImmediateTickScheduler } from "../scheduling/immediate-tick-scheduler"
import { DefaultSessionActivityMonitor } from "../sessions/session-activity-monitor"
import { FileSystemSessionCoordinator } from "../sessions/file-system-session-coordinator"
import { FileSystemHumanActionStore } from "../state/file-system-human-action-store"
import { FileSystemWorkflowStateStore } from "../state/file-system-workflow-state-store"
import { DefaultHumanActionService } from "../state/human-action-service"
import { NoopSubtaskTracker } from "../subtasks/noop-subtask-tracker"
import { DefaultWorkflowWorkspace } from "../workspace/workflow-workspace"

export interface CreateHarnessOptions {
  sessionClient?: OpencodeSessionClient
  opencodeBaseUrl?: string
  opencodePassword?: string
  homeDir?: string
}

export async function createHarness(baseDir: string, options: CreateHarnessOptions = {}) {
  await mkdir(join(baseDir, "workflows"), { recursive: true })

  const workspace = new DefaultWorkflowWorkspace(baseDir)
  await ensureAutopilotConfigFile(workspace.workflowConfigFile())
  await ensureAutopilotConfigFile(join(options.homeDir ?? homedir(), ".config", "opencode", AUTOPILOT_CONFIG_FILENAME))
  const resolvedConfig = await resolveWorkflowConfig({
    projectConfigFile: workspace.workflowConfigFile(),
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
  })
  const skillRegistryResult = await buildSkillRegistryWithWarnings(resolvedConfig.skillRoots)
  const skillRegistry = skillRegistryResult.registry
  resolvedConfig.warnings.push(...skillRegistryResult.warnings)
  const httpOptions = options.opencodeBaseUrl
    ? {
        baseUrl: options.opencodeBaseUrl,
        ...(options.opencodePassword ? { password: options.opencodePassword } : {}),
      }
    : null
  const sessionClient = options.sessionClient
    ?? (httpOptions
      ? new HttpOpencodeSessionClient(httpOptions)
      : new InMemoryOpencodeSessionClient())
  const stateStore = new FileSystemWorkflowStateStore(workspace)
  const humanActionStore = new FileSystemHumanActionStore(workspace)
  const artifactEvaluator = new FileSystemArtifactEvaluator(workspace)
  const eventStore = new FileSystemWorkflowEventStore(workspace)
  const sessionCoordinator = new FileSystemSessionCoordinator(workspace, sessionClient)
  const tickScheduler = new ImmediateTickScheduler()
  const engine = new DefaultWorkflowEngine({
    stateStore,
    humanActionStore,
    artifactEvaluator,
    phaseTransition: new DefaultPhaseTransition(),
    sessionCoordinator,
    recoveryClassifier: new BasicRecoveryClassifier(),
    subtaskTracker: new NoopSubtaskTracker(),
    tickScheduler,
    eventStore,
    workspace,
    resolvedConfig,
    skillRegistry,
  })
  tickScheduler.setHandler((workflowId) => engine.tick(workflowId))
  const sessionActivityMonitor = new DefaultSessionActivityMonitor(
    baseDir,
    stateStore,
    sessionCoordinator,
    tickScheduler,
  )

  const humanActionService = new DefaultHumanActionService(
    humanActionStore,
    stateStore,
    artifactEvaluator,
    tickScheduler,
    eventStore,
  )
  const attachService = new DefaultAttachService(
    stateStore,
    sessionActivityMonitor,
    tickScheduler,
    eventStore,
  )

  return {
    stateStore,
    humanActionStore,
    artifactEvaluator,
    eventStore,
    sessionCoordinator,
    tickScheduler,
    engine,
    humanActionService,
    attachService,
    sessionActivityMonitor,
    sessionClient,
    workspace,
    resolvedConfig,
    skillRegistry,
  }
}
