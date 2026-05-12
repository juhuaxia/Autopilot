import { beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileSystemArtifactEvaluator } from "../packages/runtime/src/artifacts/file-system-artifact-evaluator"
import { DefaultWorkflowWorkspace } from "../packages/runtime/src/workspace/workflow-workspace"

function makeWorkspace(baseDir: string): DefaultWorkflowWorkspace {
  return new DefaultWorkflowWorkspace(baseDir)
}

describe("artifact heading parser — precise level matching", () => {
  let baseDir = ""
  let workspace: DefaultWorkflowWorkspace
  let evaluator: FileSystemArtifactEvaluator

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "artifact-parser-"))
    workspace = makeWorkspace(baseDir)
    evaluator = new FileSystemArtifactEvaluator(workspace)
  })

  // ─── Helper: write artifact + evaluate ───

  async function evalPhase(workflowId: string, phase: "review" | "test" | "develop" | "spec_refinement", content: string) {
    const artifactPath = workspace.phaseArtifactFile(workflowId, phase)
    await mkdir(join(artifactPath, ".."), { recursive: true })
    await writeFile(artifactPath, content, "utf8")
    const stateFile = workspace.artifactStateFile(workflowId)
    await writeFile(
      stateFile,
      JSON.stringify({
        [phase]: { valid: false, readyForNextPhase: false, summary: "pending" },
      }),
      "utf8",
    )
    return evaluator.evaluate({ workflowId, phase } as any)
  }

  // ═══════════════════════════════════════════
  // Scenario 1: ### 结论 must NOT collide with ## 结论
  // ═══════════════════════════════════════════

  describe("heading level collision — 结论", () => {
    it("review: '### 结论：...' sub-heading does NOT hijack '## 结论' → reportStatus=pass", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 发现的问题",
        "### 结论：回归风险极低",
        "",
        "实际结论正文说明回归风险很低。",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## 结论",
        "**PASS**",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf1", "review", content)
      expect(result.reportStatus).toBe("pass")
    })

    it("test: '### 结论：...' sub-heading does NOT hijack '## 结论' → reportStatus=pass", async () => {
      const content = [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 测试概要",
        "全部通过",
        "",
        "## 失败项",
        "### 结论：无失败项",
        "",
        "## Regression 验证",
        "通过",
        "",
        "## 覆盖范围",
        "100%",
        "",
        "## 开发者决策建议",
        "可继续推进",
        "",
        "## 结论",
        "**PASS**",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf2", "test", content)
      expect(result.reportStatus).toBe("pass")
    })

    it("review: '### 结论' alone does NOT match '## 结论'", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 发现的问题",
        "### 结论",
        "这是子级结论，不是正式结论。",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf3", "review", content)
      expect(result.reportStatus).toBe("pass")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 2: ### 状态 / ### 失败项 collisions
  // ═══════════════════════════════════════════

  describe("heading level collision — 状态 / 失败项", () => {
    it("develop: '### 状态：完成' does NOT hijack '## 状态' → readyForNextPhase=true when ## 状态 has COMPLETED", async () => {
      const content = [
        "# 开发报告",
        "",
        "### 状态：子章节状态",
        "进行中",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "packages/runtime/src/artifacts/file-system-artifact-evaluator.ts",
        "",
        "## 配套修改",
        "修复标题匹配逻辑",
        "",
        "## 自检结果",
        "tests pass",
        "",
        "## 备注",
        "无",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf4", "develop", content)
      expect(result.readyForNextPhase).toBe(true)
    })

    it("test: '### 失败项：详情' does NOT hijack '## 失败项'", async () => {
      const content = [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 测试概要",
        "100/100 通过",
        "",
        "### 失败项：详细分类",
        "无",
        "",
        "## 失败项",
        "无",
        "",
        "## Regression 验证",
        "通过",
        "",
        "## 覆盖范围",
        "full",
        "",
        "## 开发者决策建议",
        "推进",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf5", "test", content)
      expect(result.reportStatus).toBe("pass")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 3: Similar prefix headings
  // ═══════════════════════════════════════════

  describe("similar prefix headings", () => {
    it("'## 验收标准' does NOT match '## 验收标准映射（extra）'", async () => {
      const specContent = [
        "# 规格精炼报告",
        "",
        "## 原始需求摘要",
        "测试需求",
        "",
        "## 需求澄清",
        "清晰",
        "",
        "## 技术约束",
        "无",
        "",
        "### 验收标准：补充说明",
        "这里是验收标准的子标题内容。",
        "",
        "## 验收标准",
        "验收标准正文。",
        "",
        "## 疑问清单",
        "无",
        "",
        "## 准入结论",
        "READY_FOR_PLAN",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const artifactPath = workspace.phaseArtifactFile("wf6", "spec_refinement")
      await mkdir(join(artifactPath, ".."), { recursive: true })
      await writeFile(artifactPath, specContent, "utf8")
      const stateFile = workspace.artifactStateFile("wf6")
      await writeFile(
        stateFile,
        JSON.stringify({
          spec_refinement: { valid: false, readyForNextPhase: false, summary: "pending" },
        }),
        "utf8",
      )

      const result = await evaluator.evaluate({ workflowId: "wf6", phase: "spec_refinement" } as any)
      expect(result.valid).toBe(true)
      expect(result.readyForNextPhase).toBe(true)
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 4: Multiple conclusion/status sections coexisting
  // ═══════════════════════════════════════════

  describe("multiple same-name different-level sections coexisting", () => {
    it("review with both ### 结论 and ## 结论 picks the correct ## 结论 body", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 发现的问题",
        "### 结论：问题1风险低",
        "详细说明...",
        "### 结论：问题2已解决",
        "详细说明...",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## 结论",
        "PASS",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf7", "review", content)
      expect(result.reportStatus).toBe("pass")
    })

    it("test reportStatus=fail when ## 结论 says FAIL despite ### 结论 saying PASS", async () => {
      const content = [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 测试概要",
        "有失败",
        "",
        "### 结论：部分通过",
        "PASS",
        "",
        "## 失败项",
        "存在失败",
        "",
        "## Regression 验证",
        "未通过",
        "",
        "## 覆盖范围",
        "partial",
        "",
        "## 开发者决策建议",
        "回到 develop",
        "",
        "## 结论",
        "FAIL",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf8", "test", content)
      expect(result.reportStatus).toBe("fail")
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 5: Backward compatibility — normal artifacts still work
  // ═══════════════════════════════════════════

  describe("backward compatibility — standard artifacts without collisions", () => {
    it("standard review artifact with PASS conclusion parses correctly", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "全部修改文件",
        "",
        "## 组件复用验收结果（如适用）",
        "不适用",
        "",
        "## Section 验收映射检查结果（如适用）",
        "不适用",
        "",
        "## 发现的问题",
        "无",
        "",
        "## 问题严重度汇总",
        "blocker: 0",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        "低",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf9", "review", content)
      expect(result.reportStatus).toBe("pass")
      expect(result.hasBlockingSeverity).toBe(false)
    })

    it("standard test artifact with PASS conclusion parses correctly", async () => {
      const content = [
        "# 测试报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 测试策略",
        "自动化测试为主",
        "",
        "## 验证范围",
        "全量",
        "",
        "## 测试概要",
        "100/100 通过",
        "",
        "## 新增页面专项验证（如适用）",
        "不适用",
        "",
        "## Figma 高保真验证（如适用）",
        "不适用",
        "",
        "## Key Visual Elements 验证（如适用）",
        "不适用",
        "",
        "## 失败项",
        "无",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 验证",
        "通过",
        "",
        "## 覆盖范围",
        "100%",
        "",
        "## 开发者决策建议",
        "可继续推进",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf10", "test", content)
      expect(result.reportStatus).toBe("pass")
    })

    it("standard develop artifact with COMPLETED status is ready", async () => {
      const content = [
        "# 开发报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "src/foo.ts",
        "",
        "## 配套修改",
        "实现功能 X",
        "",
        "## 自检结果",
        "typecheck + build + tests 全通过",
        "",
        "## 备注",
        "无",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf11", "develop", content)
      expect(result.readyForNextPhase).toBe(true)
    })

    it("develop missing non-blocking sections still advances with warnings", async () => {
      const content = [
        "# 开发报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "src/foo.ts",
        "",
        "## 自检结果",
        "typecheck + build + tests 全通过",
      ].join("\n")

      const result = await evalPhase("wf11b", "develop", content)
      expect(result.readyForNextPhase).toBe(true)
      expect(result.missing).toEqual([])
      expect(result.warnings).toEqual(expect.arrayContaining(["## 配套修改", "## 备注", "## 报告语言"]))
    })

    it("develop missing blocking self-check still blocks", async () => {
      const content = [
        "# 开发报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 修改文件",
        "src/foo.ts",
        "",
        "## 配套修改",
        "实现功能 X",
      ].join("\n")

      const result = await evalPhase("wf11c", "develop", content)
      expect(result.readyForNextPhase).toBe(false)
      expect(result.missing).toContain("## 自检结果")
    })

    it("review with FAIL conclusion and blocker severity", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 轮次",
        "第 1 轮",
        "",
        "## 检查范围",
        "代码变更",
        "",
        "## 组件复用验收结果（如适用）",
        "不适用",
        "",
        "## Section 验收映射检查结果（如适用）",
        "不适用",
        "",
        "## 发现的问题",
        "[severity:blocker] 类型错误未处理",
        "",
        "## 问题严重度汇总",
        "blocker: 1",
        "",
        "## 历史遗留观察项（非阻塞，可选）",
        "无",
        "",
        "## Regression 风险评估",
        "高",
        "",
        "## 结论",
        "未通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf12", "review", content)
      expect(result.reportStatus).toBe("fail")
      expect(result.hasBlockingSeverity).toBe(true)
    })
  })

  // ═══════════════════════════════════════════
  // Scenario 6: Edge cases
  // ═══════════════════════════════════════════

  describe("edge cases", () => {
    it("heading appearing in inline text body does NOT match", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 发现的问题",
        "请参考 ## 结论 部分的最终判定。",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf13", "review", content)
      expect(result.reportStatus).toBe("pass")
    })

    it("heading at very start of content (no leading newline) matches correctly", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf14", "review", content)
      expect(result.reportStatus).toBe("pass")
    })

    it("multiple ## 结论 headings — first one wins (same as original behavior)", async () => {
      const content = [
        "# 审查报告",
        "",
        "## 状态",
        "COMPLETED",
        "",
        "## 结论",
        "FAIL",
        "",
        "## 结论",
        "通过",
        "",
        "## 报告语言",
        "中文",
      ].join("\n")

      const result = await evalPhase("wf15", "review", content)
      expect(result.reportStatus).toBe("fail")
    })
  })
})
