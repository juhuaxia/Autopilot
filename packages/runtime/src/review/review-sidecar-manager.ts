import { readFile, writeFile } from "node:fs/promises"
import { readJsonFile } from "../shared/json-file"
import type { WorkflowWorkspace } from "../workspace/workflow-workspace"
import type { ReviewSidecarEntry, ReviewSidecarFile } from "./review-sidecar"

export class ReviewSidecarManager {
  constructor(private readonly workspace: WorkflowWorkspace) {}

  private static readonly SIDE_CAR_START = "<!-- AUTOPILOT_REVIEW_SIDE_CAR_START -->"
  private static readonly SIDE_CAR_END = "<!-- AUTOPILOT_REVIEW_SIDE_CAR_END -->"
  private static readonly REVIEW_CONCLUSION_TEMPLATE_GUIDANCE = "若 reviewer sidecar 已存在，请结合 Reviewer Summaries、Candidate Findings For Main Review 与 Reviewer Conclusion Hint 输出统一结论；如主结论已由人工或主流程明确填写，则不要被 sidecar 提示覆盖。"

  private escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  private findSectionRange(content: string, heading: string): { bodyStart: number, end: number } | null {
    const headingRegex = new RegExp(`^${this.escapeForRegex(heading)}\\n`, "m")
    const headingMatch = headingRegex.exec(content)
    if (!headingMatch || headingMatch.index < 0) {
      return null
    }

    const bodyStart = headingMatch.index + headingMatch[0].length
    const remainder = content.slice(bodyStart)
    const nextHeadingMatch = /^## /m.exec(remainder)
    const end = bodyStart + (nextHeadingMatch?.index ?? remainder.length)
    return { bodyStart, end }
  }

  private replaceSectionBody(content: string, heading: string, buildNextBody: (currentBody: string) => string | null): string {
    const range = this.findSectionRange(content, heading)
    if (!range) {
      return content
    }

    const currentBody = content.slice(range.bodyStart, range.end)
    const nextBody = buildNextBody(currentBody)
    if (nextBody == null || nextBody === currentBody) {
      return content
    }

    return `${content.slice(0, range.bodyStart)}${nextBody}${content.slice(range.end)}`
  }

  private isTemplatePendingBody(body: string, guidance?: string): boolean {
    const trimmed = body.trim()
    if (trimmed === "待判定") {
      return true
    }
    return guidance ? trimmed === `待判定\n\n${guidance}` : false
  }

  private upsertSidecarBlock(content: string, block: string): string {
    const startIndex = content.indexOf(ReviewSidecarManager.SIDE_CAR_START)
    const endIndex = content.indexOf(ReviewSidecarManager.SIDE_CAR_END)

    if (startIndex >= 0 && endIndex >= startIndex) {
      const before = content.slice(0, startIndex).trimEnd()
      const after = content.slice(endIndex + ReviewSidecarManager.SIDE_CAR_END.length).trimStart()
      const merged = [before, block, after].filter((part) => part.length > 0).join("\n\n")
      return `${merged}\n`
    }

    const stripped = content.trimEnd()
    return stripped.length > 0 ? `${stripped}\n\n${block}\n` : `${block}\n`
  }

  async write(workflowId: string, sidecar: ReviewSidecarFile): Promise<void> {
    const next = `${JSON.stringify(sidecar, null, 2)}\n`
    const current = await readFile(this.workspace.reviewSidecarFile(workflowId), "utf8").catch(() => "")
    if (current === next) {
      return
    }
    await writeFile(this.workspace.reviewSidecarFile(workflowId), next, "utf8")
  }

  async read(workflowId: string): Promise<ReviewSidecarFile | null> {
    return readJsonFile<ReviewSidecarFile>(this.workspace.reviewSidecarFile(workflowId))
  }

  async appendOrUpdateEntry(workflowId: string, entry: ReviewSidecarEntry): Promise<void> {
    const current = await this.read(workflowId)
    const entries = current?.entries ?? []
    const nextEntries = entries.some((item) => item.reviewerSessionId === entry.reviewerSessionId)
      ? entries.map((item) => item.reviewerSessionId === entry.reviewerSessionId ? entry : item)
      : [...entries, entry]
    await this.write(workflowId, {
      workflowId,
      presetMode: current?.presetMode ?? null,
      mergeMode: current?.mergeMode ?? null,
      completedAt: current?.completedAt ?? null,
      readyToConsolidate: current?.readyToConsolidate ?? false,
      updatedAt: new Date().toISOString(),
      entries: nextEntries,
    })
  }

  async updateEntryStatus(workflowId: string, reviewerSessionId: string, status: ReviewSidecarEntry["status"], lastError?: string): Promise<void> {
    const current = await this.read(workflowId)
    if (!current?.entries?.length) {
      return
    }
    const nextEntries = current.entries.map((entry) => entry.reviewerSessionId === reviewerSessionId
      ? {
          ...entry,
          status,
          ...(lastError ? { lastError } : {}),
          ...(status === "idle" ? { lastSummary: entry.lastSummary ?? null } : {}),
          updatedAt: new Date().toISOString(),
        }
      : entry)
    await this.write(workflowId, {
      workflowId,
      presetMode: current.presetMode ?? null,
      mergeMode: current.mergeMode ?? null,
      completedAt: current.completedAt ?? null,
      readyToConsolidate: current.readyToConsolidate ?? false,
      updatedAt: new Date().toISOString(),
      entries: nextEntries,
    })
  }

  async updateEntrySummary(workflowId: string, reviewerSessionId: string, summary: string | null): Promise<void> {
    const current = await this.read(workflowId)
    if (!current?.entries?.length) {
      return
    }
    const nextEntries = current.entries.map((entry) => entry.reviewerSessionId === reviewerSessionId
      ? {
          ...entry,
          lastSummary: summary,
          ...(summary ? this.parseStructuredIssue(summary) : {}),
          updatedAt: new Date().toISOString(),
        }
      : entry)
    await this.write(workflowId, {
      workflowId,
      presetMode: current.presetMode ?? null,
      mergeMode: current.mergeMode ?? null,
      completedAt: current.completedAt ?? null,
      readyToConsolidate: current.readyToConsolidate ?? false,
      updatedAt: new Date().toISOString(),
      entries: nextEntries,
    })
  }

  private parseStructuredIssue(summary: string): Partial<ReviewSidecarEntry> {
    const lower = summary.toLowerCase()
    const severity = lower.includes("blocker")
      ? "blocker"
      : lower.includes("critical")
        ? "critical"
        : lower.includes("high")
          ? "high"
          : lower.includes("medium")
            ? "medium"
            : lower.includes("low")
              ? "low"
              : null

    const confidence = lower.includes("high confidence") || lower.includes("confident")
      ? "high"
      : lower.includes("low confidence") || lower.includes("uncertain")
        ? "low"
        : lower.includes("medium confidence")
          ? "medium"
          : null

    const source = summary.split(/\n+/)[0]?.trim() ?? null

    return {
      ...(severity ? { issueSeverity: severity } : {}),
      ...(confidence ? { issueConfidence: confidence } : {}),
      ...(source ? { issueSource: source } : {}),
    }
  }

  async markCompletedIfSettled(workflowId: string): Promise<void> {
    const current = await this.read(workflowId)
    if (!current?.entries?.length || current.completedAt) {
      return
    }
    const settled = current.entries.every((entry) => entry.status === "idle" || entry.status === "failed" || entry.status === "completed")
    if (!settled) {
      return
    }
    await this.write(workflowId, {
      workflowId,
      presetMode: current.presetMode ?? null,
      mergeMode: current.mergeMode ?? null,
      completedAt: new Date().toISOString(),
      readyToConsolidate: true,
      updatedAt: new Date().toISOString(),
      entries: current.entries,
    })
  }

  async syncReviewArtifact(workflowId: string): Promise<void> {
    const sidecar = await this.read(workflowId)
    if (!sidecar?.entries?.length) {
      return
    }

    const reviewArtifactPath = this.workspace.phaseArtifactFile(workflowId, "review")
    const current = await readFile(reviewArtifactPath, "utf8").catch(() => "")
    if (!current.trim()) {
      return
    }

    const findings = sidecar.entries
      .map((entry) => ({
        roleName: entry.roleName,
        summary: entry.lastSummary?.trim() || "summary unavailable",
        status: entry.status,
        severity: entry.issueSeverity ?? "unknown",
        confidence: entry.issueConfidence ?? "unknown",
        source: entry.issueSource ?? "unknown",
      }))
      .filter((entry) => entry.summary.length > 0)

    const severityCounts = findings.reduce<Record<string, number>>((acc, entry) => {
      acc[entry.severity] = (acc[entry.severity] ?? 0) + 1
      return acc
    }, {})

    const conclusionHint = (() => {
      const conflictMode = sidecar.mergeMode ?? "prefer_conservative"
      const hasHighRisk = (severityCounts.blocker ?? 0) > 0 || (severityCounts.critical ?? 0) > 0 || (severityCounts.high ?? 0) > 0
      if (!sidecar.completedAt) {
        return "reviewer sessions not settled; conclusion hint pending"
      }
      if (conflictMode === "prefer_conservative" && hasHighRisk) {
        return "conservative hint: unresolved or high-risk reviewer signals suggest FAIL/needs-fix"
      }
      if (hasHighRisk) {
        return `hint: reviewer signals include high-risk findings under mergeMode=${conflictMode}`
      }
      return `hint: no high-risk reviewer findings detected under mergeMode=${conflictMode}`
    })()

    const conclusionCandidate = (() => {
      if (!sidecar.readyToConsolidate) {
        return "PENDING"
      }
      return conclusionHint.includes("FAIL") || conclusionHint.includes("needs-fix") ? "FAIL" : "PASS"
    })()

    let hydrated = this.replaceSectionBody(current, "## 状态", (body) => {
      if (!this.isTemplatePendingBody(body)) {
        return null
      }
      const candidateStatus = sidecar.readyToConsolidate
        ? conclusionCandidate === "FAIL"
          ? "FAIL"
          : "PASS"
        : "待判定"
      return `${candidateStatus}\n\n`
    })

    hydrated = this.replaceSectionBody(hydrated, "## 结论", (body) => {
      if (!this.isTemplatePendingBody(body, ReviewSidecarManager.REVIEW_CONCLUSION_TEMPLATE_GUIDANCE)) {
        return null
      }
      if (!sidecar.readyToConsolidate) {
        return body
      }
      return `${conclusionCandidate}\n\n[Consolidation Recommendation]\n${conclusionHint}\n\n`
    })

    if (!hydrated.includes("# 审查报告") || !hydrated.includes("## 结论")) {
      return
    }

    const lines = [
      ReviewSidecarManager.SIDE_CAR_START,
      "## Reviewer Summaries",
      ...sidecar.entries.map((entry) => `- ${entry.roleName} [${entry.status}]: ${entry.lastSummary ?? "summary unavailable"}`),
      "",
      "## Reviewer Findings Summary",
      ...(findings.length > 0
        ? findings.map((entry) => `- ${entry.roleName} [${entry.status}]: ${entry.summary}`)
        : ["- 无 reviewer 摘要可汇总"]),
      "",
      "## Reviewer Issues",
      ...(findings.length > 0
        ? findings.map((entry) => `- ${entry.roleName}: severity=${entry.severity}; confidence=${entry.confidence}; source=${entry.source}`)
        : ["- 无结构化 reviewer issue 可汇总"]),
      "",
      "## Candidate Findings For Main Review",
      ...(findings.length > 0
        ? findings.map((entry) => `- candidate finding from ${entry.roleName}: severity=${entry.severity}; summary=${entry.summary}`)
        : ["- 无 candidate finding 可聚合"]),
      "",
      "## Reviewer Severity Summary",
      ...(Object.keys(severityCounts).length > 0
        ? Object.entries(severityCounts).map(([severity, count]) => `- ${severity}: ${count}`)
        : ["- unknown: 0"]),
      "",
      "## Reviewer Conclusion Hint",
      conclusionHint,
      "",
      "## Reviewer Consolidation Recommendation",
      sidecar.readyToConsolidate
        ? `consolidation recommendation: use mergeMode=${sidecar.mergeMode ?? "prefer_conservative"} to derive the main review conclusion from reviewer evidence`
        : "consolidation recommendation pending reviewer completion",
      "",
      "## Consolidation Recommendation For Main Conclusion",
      sidecar.readyToConsolidate
        ? `recommended main conclusion: ${conclusionCandidate}\n${conclusionHint}; this recommendation may be used to assist the main ## 结论 when that section is still pending.`
        : "main conclusion recommendation pending reviewer consolidation",
      "",
      "## Review Merge Context",
      `- presetMode: ${sidecar.presetMode ?? "unknown"}`,
      `- mergeMode: ${sidecar.mergeMode ?? "prefer_conservative"}`,
      `- reviewerCount: ${sidecar.entries.length}`,
      `- completion: ${sidecar.completedAt ? `completed@${sidecar.completedAt}` : "pending"}`,
      `- readyToConsolidate: ${sidecar.readyToConsolidate ? "yes" : "no"}`,
      ReviewSidecarManager.SIDE_CAR_END,
    ]

    const nextContent = this.upsertSidecarBlock(hydrated, lines.join("\n"))
    if (current === nextContent) {
      return
    }
    await writeFile(reviewArtifactPath, nextContent, "utf8")
  }
}
