import { readFile } from "node:fs/promises"
import type { Phase } from "../../../core/src/state/phase"
import { ARTIFACT_REPAIR_REASON_PREFIX } from "../../../core/src/transitions/default-phase-transition"
import { loadResolvedSkillContents, resolveSkillPaths } from "../config/skill-registry"
import { resolveEffectiveUnderstandingDepth, type UnderstandingDepth, type WorkflowConfigPhase } from "../config/workflow-config"
import type { WorkflowEngine, WorkflowEngineDeps } from "./workflow-engine"

export class DefaultWorkflowEngine implements WorkflowEngine {
  constructor(private readonly deps: WorkflowEngineDeps) {}

  private buildArtifactRepairPromptLines(args: {
    phase: Extract<Phase, "develop" | "review" | "test">
    artifactMissing: string[]
    artifactPath: string
    completionPolicy: string
    currentContent: string
  }): string[] {
    const lines: string[] = []

    if (args.artifactMissing.length > 0) {
      lines.push("[MISSING]")
      lines.push(...args.artifactMissing.map((item) => `- ${item}`))
    }

    lines.push("[ARTIFACT_REPAIR_POLICY]")
    lines.push(`Do not modify application code, routes, APIs, assets, tests, or any non-artifact files in this dispatch. Only repair the ${args.phase} artifact at the target path. Replace template placeholders with actual ${args.phase} evidence/results, and set the required completion or conclusion sections correctly.`)
    lines.push(`[COMPLETION_POLICY] ${args.completionPolicy}`)
    lines.push(`[ARTIFACT_PATH] ${args.artifactPath}`)
    if (args.currentContent) {
      lines.push("[CURRENT_ARTIFACT]")
      lines.push(args.currentContent)
    }

    return lines
  }

  private isArtifactPhase(phase: string): phase is Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test"> {
    return phase === "spec_refinement"
      || phase === "plan"
      || phase === "develop"
      || phase === "review"
      || phase === "test"
  }

  private buildRefinementDispatchSummary(args: {
    missing: string[]
    questionCount: number
    attempt: number
  }): string {
    return `attempt=${args.attempt}; missing=${args.missing.length}; openQuestions=${args.questionCount}`
  }

  private async buildDispatchPrompt(workflowId: string, phase: string, reason: string): Promise<string> {
    if (!this.isArtifactPhase(phase)) {
      return reason
    }

    const isArtifactOnlyRepair = (phase === "develop" || phase === "review" || phase === "test")
      && reason.startsWith(ARTIFACT_REPAIR_REASON_PREFIX)

    const workflow = await this.deps.stateStore.getWorkflow(workflowId)
    const artifact = workflow ? await this.deps.artifactEvaluator.evaluate(workflow) : null
    let currentContent = ""
    try {
      currentContent = await readFile(
        this.deps.workspace.phaseArtifactFile(workflowId, phase),
        "utf8",
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes("ENOENT")) {
        throw error
      }
    }

    const phaseGoalByType: Record<Extract<Phase, "spec_refinement" | "plan" | "develop" | "review" | "test">, string> = {
      spec_refinement: "Produce a refinement artifact that can reach READY_FOR_PLAN once true ambiguities are resolved.",
      plan: "Produce a concrete implementation plan aligned to the refinement artifact and keep the plan document complete.",
      develop: "Implement the approved plan, update project code, and write a completed develop report artifact.",
      review: "Perform review against implementation and write a review report with PASS/FAIL conclusion and severity summary.",
      test: "Run verification/testing and write a test report with PASS/FAIL status and clear evidence.",
    }

    const completionPolicyByPhase: Record<string, string> = {
      spec_refinement: "Set 准入结论 to READY_FOR_PLAN when ambiguity is truly resolved.",
      plan: "Keep all required sections complete and ensure plan is approvable.",
      develop: "Set ## 状态 to COMPLETED/通过/完成 only after implementation and self-check are done.",
      review: "Set ## 状态 and ## 结论 with explicit pass/fail semantics and include issue severity summary.",
      test: "Set ## 状态 and ## 结论 with explicit pass/fail semantics and include regression/coverage evidence.",
    }

    const understandingGuidanceByDepth: Record<UnderstandingDepth, string> = {
      lightweight:
        "Focus on extracting core intent and explicit request boundary. Do not trace full dependency chains or perform deep codebase analysis unless ambiguity is detected. Keep analysis scoped to what is directly referenced in the user request. Avoid over-analysis of unrelated modules.",
      standard:
        "Trace direct dependencies, parent components, and immediate import chains relevant to the change. Identify impact scope on neighboring modules. Verify changes against existing patterns in the codebase. Document which files were examined and why they are relevant.",
      deep:
        "Perform comprehensive dependency tracing including parent components, parent routes, stores, composables, services, helpers, shared modules, API contracts, permission boundaries, and cross-module impacts. Document full call chains, state flow, and data dependencies. Map upstream/downstream effects. Record all traced files and justify each inclusion/exclusion in the analysis scope.",
    }

    const lines = [
      `[PHASE] ${phase}`,
      `[GOAL] ${phaseGoalByType[phase]}`,
      `[REASON] ${reason}`,
    ]

    if (isArtifactOnlyRepair) {
      const repairPhase = phase as Extract<Phase, "develop" | "review" | "test">
      const repairCompletionPolicy = completionPolicyByPhase[repairPhase] ?? "Set the required completion or conclusion sections correctly."
      lines.push(...this.buildArtifactRepairPromptLines({
        phase: repairPhase,
        artifactMissing: artifact?.missing ?? [],
        artifactPath: this.deps.workspace.phaseArtifactFile(workflowId, phase),
        completionPolicy: repairCompletionPolicy,
        currentContent,
      }))
      return lines.join("\n\n")
    }

    if (phase === "plan") {
      try {
        const refinementContent = await readFile(this.deps.workspace.phaseArtifactFile(workflowId, "spec_refinement"), "utf8")
        lines.push("[SOURCE_REFINEMENT_ARTIFACT]")
        lines.push(refinementContent)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("ENOENT")) {
          throw error
        }
      }
    }

    if (phase === "develop") {
      try {
        const planContent = await readFile(this.deps.workspace.phaseArtifactFile(workflowId, "plan"), "utf8")
        lines.push("[SOURCE_PLAN_ARTIFACT]")
        lines.push(planContent)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("ENOENT")) {
          throw error
        }
      }
    }

    if (phase === "review") {
      try {
        const developContent = await readFile(this.deps.workspace.phaseArtifactFile(workflowId, "develop"), "utf8")
        lines.push("[SOURCE_DEVELOP_ARTIFACT]")
        lines.push(developContent)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("ENOENT")) {
          throw error
        }
      }
    }

    if (phase === "test") {
      try {
        const reviewContent = await readFile(this.deps.workspace.phaseArtifactFile(workflowId, "review"), "utf8")
        lines.push("[SOURCE_REVIEW_ARTIFACT]")
        lines.push(reviewContent)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes("ENOENT")) {
          throw error
        }
      }
    }

    if (artifact?.missing && artifact.missing.length > 0) {
      lines.push("[MISSING]")
      lines.push(...artifact.missing.map((item) => `- ${item}`))
    }

    if (artifact?.warnings && artifact.warnings.length > 0) {
      lines.push("[WARNINGS]")
      lines.push(...artifact.warnings.map((item) => `- ${item}`))
    }

    if (artifact?.questions && artifact.questions.length > 0) {
      lines.push("[OPEN_QUESTIONS]")
      lines.push(
        ...artifact.questions.map((question) => `- (${question.id}) [${question.priority}] ${question.text}`),
      )
    }

    lines.push("[POLICY] Autofill what can be safely inferred. Preserve existing content. Ask humans only for genuine ambiguity. Keep section headings unchanged. Never import or reference icons, images, assets, or components unless you have verified they already exist in the repository. Do not invent import paths, filenames, asset names, or icon exports.")
    if (phase === "spec_refinement") {
      lines.push("[AI_INTAKE_POLICY] Interpret user natural language directly. Extract requirement intent, infer referenced document locations from user wording, and read project documents with your tools before updating artifact sections. Use [DOC_CANDIDATES] as recall-only hints; make final relevance decisions semantically. Do not require user to provide structured JSON.")
    }
    if (phase === "plan") {
      lines.push("[PLAN_POLICY] Build a concrete implementation plan from the refinement artifact. First identify the actual feature entry point in the codebase. If behavior is controlled by parent components, parent routes, shared modules, imported functions, composables, stores, services, APIs, or other upstream/downstream dependencies, continue tracing them until the behavior boundary is clear. Replace placeholder text with repository-specific scope, file impact, implementation steps, risk analysis, approval-ready detail, explicit regression considerations, and evidence of dependency/impact tracing where relevant. Keep section headings unchanged.")
    }
    if (phase === "develop") {
      lines.push("[DEVELOP_POLICY] Execute against the approved plan artifact. Before editing a leaf file, verify whether parent components, entry points, routes, stores, composables, services, helpers, imported functions, or shared modules also participate in the feature logic. If they do, continue tracing and update the implementation scope accordingly. When icons, images, or other assets are missing, do not create non-existent imports. Either temporarily reuse an existing in-repo asset that actually exists and disclose that substitution in the final report, or ask the user for the correct resource when no acceptable existing asset fits. Update code first, then rewrite the develop artifact with actual changed files, supporting changes, self-check evidence, and explicit regression checks for impacted existing behavior. Set ## 状态 to COMPLETED only when implementation and validation are truly done.")
    }
    if (phase === "review") {
      lines.push("[REVIEW_POLICY] Review the implementation against the develop artifact and plan intent. Explicitly check whether the implementation missed parent components, parent routes, imported dependencies, shared modules, services, stores, composables, helpers, or other upstream/downstream files that should have been traced. Also fail the review if the implementation introduces unverified icon/image/asset/component imports, fabricated resource references, or non-existent export names. Record concrete findings, severity summary, dependency-tracing gaps if any, regression risk to existing functionality, and set explicit pass/fail conclusion in the review artifact. Keep section headings unchanged.")
    }
    if (phase === "test") {
      lines.push("[TEST_POLICY] Validate the implementation and review findings. Ensure testing covers both the requested behavior and any affected upstream/downstream files, parent-controlled flows, shared dependencies, and previously working functionality touched by the traced impact boundary. Update the test artifact with executed checks, failures, regression evidence for impacted existing features, coverage summary, and set explicit pass/fail conclusion. Keep section headings unchanged.")
    }

    if (this.isArtifactPhase(phase) && this.deps.resolvedConfig) {
      const effectiveDepth = resolveEffectiveUnderstandingDepth({
        phase: phase as WorkflowConfigPhase,
        config: this.deps.resolvedConfig,
      })
      const depthGuidance = understandingGuidanceByDepth[effectiveDepth]
      const activeRiskSignals = this.deps.resolvedConfig.riskSignals ?? []
      lines.push("[UNDERSTANDING_POLICY]")
      lines.push(`Effective depth: ${effectiveDepth}`)
      lines.push(depthGuidance)
      if (activeRiskSignals.length > 0) {
        lines.push("")
        lines.push("Available risk signals (reference when assessing task complexity):")
        for (const signal of activeRiskSignals) {
          lines.push(`- [${signal.id}] ${signal.description}${signal.triggersDeep ? " (triggers deep)" : ""}`)
        }
      }
    }

    if ((phase === "spec_refinement" || phase === "plan" || phase === "develop" || phase === "review" || phase === "test") && this.deps.resolvedConfig?.phases?.[phase]?.requiredSkills?.length) {
      const requiredSkills = this.deps.resolvedConfig.phases[phase]?.requiredSkills ?? []
      const resolvedSkills = this.deps.skillRegistry
        ? resolveSkillPaths(this.deps.skillRegistry, requiredSkills)
        : []
      const loadedSkills = this.deps.skillRegistry
        ? await loadResolvedSkillContents(this.deps.skillRegistry, requiredSkills)
        : []
      lines.push("[REQUIRED_SKILLS]")
      for (const skillName of requiredSkills) {
        const resolved = resolvedSkills.find((entry) => entry.name === skillName)
        lines.push(resolved ? `- ${skillName} :: ${resolved.path}` : `- ${skillName}`)
      }
      const missingSkills = requiredSkills.filter((skillName) => !resolvedSkills.some((entry) => entry.name === skillName))
      if (missingSkills.length > 0) {
        lines.push("[MISSING_SKILLS]")
        lines.push(...missingSkills.map((skillName) => `- ${skillName}`))
      }
      if (loadedSkills.length > 0) {
        lines.push("[SKILL_CONTENT]")
        for (const skill of loadedSkills) {
          lines.push(`[SKILL ${skill.name}]`)
          lines.push(skill.content)
        }
      }
    }

    if (this.deps.resolvedConfig?.warnings?.length) {
      lines.push("[CONFIG_WARNINGS]")
      lines.push(...this.deps.resolvedConfig.warnings.map((warning) => `- ${warning}`))
    }

    lines.push(`[COMPLETION_POLICY] ${completionPolicyByPhase[phase]}`)
    lines.push(`[ARTIFACT_PATH] ${this.deps.workspace.phaseArtifactFile(workflowId, phase)}`)

    if (currentContent) {
      lines.push("[CURRENT_ARTIFACT]")
      lines.push(currentContent)
    }

    return lines.join("\n\n")
  }

  async tick(workflowId: string): Promise<void> {
    const workflow = await this.deps.stateStore.getWorkflow(workflowId)
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`)
    }

    const runtime = await this.deps.stateStore.getRuntime(workflowId)
    if (!runtime) {
      throw new Error(`Runtime state not found: ${workflowId}`)
    }

    const artifact = await this.deps.artifactEvaluator.evaluate(workflow)
    const currentHumanAction = await this.deps.humanActionStore.getCurrent(workflowId)
    const session = await this.deps.sessionCoordinator.getRelevantSession(workflowId)
    const hasRunningSubtasks = await this.deps.subtaskTracker.hasRunningSubtasks(workflowId)

    const action = await this.deps.phaseTransition.decide({
      workflow,
      runtime,
      artifact,
      currentHumanAction,
      session,
      hasRunningSubtasks,
    })

    switch (action.type) {
      case "wait_human": {
        if (!currentHumanAction || currentHumanAction.status === "consumed") {
          const record = await this.deps.humanActionStore.create(action.action)
          await this.deps.humanActionStore.markPresented(record.id)
          await this.deps.stateStore.updateWorkflow(workflowId, {
            status: "waiting_human",
          })
          const waitRuntimePatch = {
            blockedFromPhase: null,
            waitingHumanActionId: record.id,
            phaseDispatchAttempts: {
              ...(runtime.phaseDispatchAttempts ?? {}),
              ...(workflow.phase === "spec_refinement" || workflow.phase === "plan" || workflow.phase === "develop" || workflow.phase === "review" || workflow.phase === "test"
                ? { [workflow.phase]: 0 }
                : {}),
            },
            developArtifactRepairDispatchPending: false,
            reviewArtifactRepairDispatchPending: false,
            testArtifactRepairDispatchPending: false,
            ...(workflow.phase === "spec_refinement" && (runtime.refinementAttempts ?? 0) > 0
              ? { refinementEscalationReason: "Autonomous refinement retry budget exhausted" }
              : {}),
          }
          await this.deps.stateStore.updateRuntime(workflowId, waitRuntimePatch)
          await this.deps.eventStore.append({
            workflowId,
            type: "human_action.required",
            at: new Date().toISOString(),
            payload: {
              humanActionId: record.id,
              actionType: action.action.type,
              phase: action.action.phase,
              reason: action.action.reason,
            },
          })
          if (action.action.reason.includes("artifact-only repair attempt")) {
            await this.deps.eventStore.append({
              workflowId,
              type: "artifact.repair_blocked",
              at: new Date().toISOString(),
              payload: {
                phase: action.action.phase,
                reason: action.action.reason,
                summary: action.action.summary,
              },
            })
          }
        }
        return
      }

      case "advance_phase": {
        const iterationPatch = workflow.phase === "review"
          && action.nextPhase === "develop"
          ? { iteration: workflow.iteration + 1 }
          : {}

        if (workflow.phase === "test" && action.nextPhase === "done") {
          const finalArtifact = await this.deps.artifactEvaluator.evaluate(workflow)
          if (!(finalArtifact.valid && finalArtifact.missing.length === 0 && finalArtifact.reportStatus === "pass")) {
            return
          }
        }

        if (currentHumanAction && currentHumanAction.status !== "consumed") {
          await this.deps.humanActionStore.markConsumed(currentHumanAction.id)
          await this.deps.stateStore.updateRuntime(workflowId, {
            blockedFromPhase: null,
            waitingHumanActionId: null,
            consecutiveFailures: 0,
              phaseDispatchAttempts: {},
              lastArtifactSignalSignature: null,
              developArtifactRepairDispatchPending: false,
              reviewArtifactRepairDispatchPending: false,
              testArtifactRepairDispatchPending: false,
              ...(workflow.phase === "spec_refinement"
                ? {
                  refinementAttempts: 0,
                  refinementLastDispatchSummary: null,
                  refinementEscalationReason: null,
                }
              : {}),
          })
        }

        await this.deps.sessionCoordinator.archiveIrrelevantSessions(
          workflowId,
          action.nextPhase,
        )
        await this.deps.artifactEvaluator.prepareForPhase?.(
          workflowId,
          action.nextPhase,
          workflow.phase,
        )
        await this.deps.stateStore.updateWorkflow(workflowId, {
          phase: action.nextPhase,
          status: action.nextPhase === "done" ? "completed" : "pending",
          phaseEnteredAt: new Date().toISOString(),
          activeSessionId: null,
          blockReason: null,
          ...iterationPatch,
        })
        await this.deps.eventStore.append({
          workflowId,
          type: "phase.changed",
          at: new Date().toISOString(),
          payload: {
            from: workflow.phase,
            to: action.nextPhase,
            iteration: workflow.phase === "review" && action.nextPhase === "develop"
              ? workflow.iteration + 1
              : workflow.iteration,
          },
        })
        if (action.nextPhase !== "done") {
          await this.deps.tickScheduler.requestTick(workflowId, "phase advanced")
        }
        return
      }

      case "dispatch": {
        const sessionId = await this.deps.sessionCoordinator.ensureSession(
          workflowId,
          action.phase,
          action.phase === "develop" || action.phase === "review" || action.phase === "test"
            ? runtime.preferredForegroundSessionId ?? null
            : null,
        )
        const prompt = await this.buildDispatchPrompt(workflowId, action.phase, action.reason)
        const nextAttempt = action.phase === "spec_refinement"
          ? (runtime.refinementAttempts ?? 0) + 1
          : 0
        const runtimePatch = {
          blockedFromPhase: null,
          lastContinuationAt: new Date().toISOString(),
          consecutiveFailures: 0,
          lastArtifactSignalSignature: action.phase === "spec_refinement" || action.phase === "plan" || action.phase === "develop" || action.phase === "review" || action.phase === "test"
            ? [
                action.phase,
                ...artifact.missing.map((item) => `missing:${item}`),
                ...(artifact.warnings ?? []).map((item) => `warning:${item}`),
                `summary:${artifact.summary ?? ""}`,
              ].join("|")
            : null,
          phaseDispatchAttempts: {
            ...(runtime.phaseDispatchAttempts ?? {}),
            ...(action.phase === "spec_refinement" || action.phase === "plan" || action.phase === "develop" || action.phase === "review" || action.phase === "test"
              ? { [action.phase]: (runtime.phaseDispatchAttempts?.[action.phase] ?? 0) + 1 }
              : {}),
          },
          developArtifactRepairDispatchPending: action.phase === "develop"
            ? action.reason.startsWith(ARTIFACT_REPAIR_REASON_PREFIX)
            : false,
          reviewArtifactRepairDispatchPending: action.phase === "review"
            ? action.reason.startsWith(ARTIFACT_REPAIR_REASON_PREFIX)
            : false,
          testArtifactRepairDispatchPending: action.phase === "test"
            ? action.reason.startsWith(ARTIFACT_REPAIR_REASON_PREFIX)
            : false,
          ...(action.phase === "spec_refinement"
            ? {
                refinementAttempts: nextAttempt,
                refinementLastDispatchSummary: this.buildRefinementDispatchSummary({
                  missing: artifact.missing,
                  questionCount: artifact.questions?.length ?? 0,
                  attempt: nextAttempt,
                }),
                refinementEscalationReason: null,
              }
            : {}),
        }
        await this.deps.stateStore.updateWorkflow(workflowId, {
          activeSessionId: sessionId,
          status: "in_progress",
        })
        await this.deps.sessionCoordinator.inject(
          workflowId,
          sessionId,
          prompt,
        )
        await this.deps.stateStore.updateRuntime(workflowId, runtimePatch)
        await this.deps.eventStore.append({
          workflowId,
          type: "session.dispatched",
          at: new Date().toISOString(),
          payload: {
            sessionId,
            phase: action.phase,
            reason: prompt,
          },
        })
        return
      }

      case "recover": {
        const disposition = this.deps.recoveryClassifier.classify(action.reason)
        await this.deps.stateStore.updateRuntime(workflowId, {
          blockedFromPhase: workflow.phase === "blocked"
            ? runtime.blockedFromPhase ?? null
            : workflow.phase,
          recoveryState: disposition === "terminal" ? "idle" : "recovering",
          consecutiveFailures: runtime.consecutiveFailures + 1,
        })
        if (disposition === "retryable") {
          await this.deps.tickScheduler.requestTick(workflowId, "retry recovery")
          return
        }

        await this.deps.stateStore.updateWorkflow(workflowId, {
          phase: "blocked",
          status: "blocked",
          blockReason: action.reason,
        })
        await this.deps.eventStore.append({
          workflowId,
          type: "workflow.blocked",
          at: new Date().toISOString(),
          payload: {
            reason: action.reason,
          },
        })
        return
      }

      case "stop":
        return
    }
  }
}
