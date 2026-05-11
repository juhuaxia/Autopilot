import { readFile } from "node:fs/promises"
import type { Phase } from "../../../core/src/state/phase"
import { loadResolvedSkillContents, resolveSkillPaths } from "../config/skill-registry"
import type { WorkflowEngine, WorkflowEngineDeps } from "./workflow-engine"

export class DefaultWorkflowEngine implements WorkflowEngine {
  constructor(private readonly deps: WorkflowEngineDeps) {}

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

    const lines = [
      `[PHASE] ${phase}`,
      `[GOAL] ${phaseGoalByType[phase]}`,
      `[REASON] ${reason}`,
    ]

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

    if (artifact?.questions && artifact.questions.length > 0) {
      lines.push("[OPEN_QUESTIONS]")
      lines.push(
        ...artifact.questions.map((question) => `- (${question.id}) [${question.priority}] ${question.text}`),
      )
    }

    lines.push("[POLICY] Autofill what can be safely inferred. Preserve existing content. Ask humans only for genuine ambiguity. Keep section headings unchanged.")
    if (phase === "spec_refinement") {
      lines.push("[AI_INTAKE_POLICY] Interpret user natural language directly. Extract requirement intent, infer referenced document locations from user wording, and read project documents with your tools before updating artifact sections. Use [DOC_CANDIDATES] as recall-only hints; make final relevance decisions semantically. Do not require user to provide structured JSON.")
    }
    if (phase === "plan") {
      lines.push("[PLAN_POLICY] Build a concrete implementation plan from the refinement artifact. Replace placeholder text with repository-specific scope, file impact, implementation steps, risk analysis, approval-ready detail, and explicit regression considerations for existing functionality that may be affected. Keep section headings unchanged.")
    }
    if (phase === "develop") {
      lines.push("[DEVELOP_POLICY] Execute against the approved plan artifact. Update code first, then rewrite the develop artifact with actual changed files, supporting changes, self-check evidence, and explicit regression checks for impacted existing behavior. Set ## 状态 to COMPLETED only when implementation and validation are truly done.")
    }
    if (phase === "review") {
      lines.push("[REVIEW_POLICY] Review the implementation against the develop artifact and plan intent. Record concrete findings, severity summary, regression risk to existing functionality, and set explicit pass/fail conclusion in the review artifact. Keep section headings unchanged.")
    }
    if (phase === "test") {
      lines.push("[TEST_POLICY] Validate the implementation and review findings. Update the test artifact with executed checks, failures, regression evidence for previously working features, coverage summary, and set explicit pass/fail conclusion. Keep section headings unchanged.")
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
            waitingHumanActionId: record.id,
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
            waitingHumanActionId: null,
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
          lastContinuationAt: new Date().toISOString(),
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
