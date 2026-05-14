# Autopilot

**把一句自然语言需求，自动变成一套有流程、可审核、可追溯的完整交付。**

[English](./README.md) | 中文说明

---

## Autopilot 是什么？

Autopilot 是一个运行在 [OpenCode](https://github.com/opencode-ai/opencode) 中的插件。你可以把它理解为一个 **AI 项目经理**——你只管说需求，它负责把需求拆成 5 个可控阶段，一步步推进：

```
你的需求 → 需求精炼 → 制定计划 → 实现代码 → 代码评审 → 测试验证 → 完成
             ↑ 可交互    ↑ 需要你批准   ↑ 自动推进   ↑ 可反馈     ↑ 查看结果
```

每个阶段都会产出一份文档，你可以阅读、修改或批准后再进入下一步。**你始终掌握主导权，AI 负责执行。**

## 为什么用 Autopilot？

| 没用 Autopilot | 用了 Autopilot |
|---|---|
| 一句话丢给 AI，结果不可控 | 分阶段推进，每一步都看得见 |
| AI 可能误解需求就开始写代码 | 先把需求理清楚，确认后才动手 |
| 一次生成一大段代码，很难审查 | 每个阶段都有独立产物，逐项检查 |
| 回归风险全靠人脑记忆 | 影响范围和风险信号被自动追踪 |
| 每次 AI 写代码风格都不一样 | 通过 Skill 注入团队统一规范 |

**适合谁：**
- 希望用 AI 辅助写代码、但担心质量失控的开发者
- 需要 AI 生成代码保持团队一致性的团队
- 体验过"AI 写了 500 行、一半是错的"的人

## 快速上手（3 步）

### 第 1 步：安装插件

在你的 OpenCode 配置文件（`opencode.json`）中加入：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

然后重启 OpenCode。如果加载成功，你会看到类似日志：

```
[autopilot] Autopilot plugin loaded (... commands)
```

### 第 2 步：发起你的第一个工作流

直接用自然语言描述你的需求就行。比如：

> 给商品列表页增加排序功能，并注意回归风险。

Autopilot 会自动接管，开始引导整个流程。

### 第 3 步：跟着提示走

Autopilot 会在关键节点与你交互：

- **需求精炼阶段**：如果需求有不明确的地方，它会提问。你回答后继续。
- **计划阶段**：它会展示实现方案。你觉得没问题就批准。
- **实现 / 评审 / 测试**：这几个阶段基本自动运行，每个阶段结束时会展示结果。

通常一个需求只需要 **3～5 次交互**——大部分时候只是回答几个问题或者点一下批准。

## 工作流各阶段说明

| 阶段 | 发生了什么 | 你需要做什么 |
|---|---|---|
| **需求精炼** | 分析你的需求，补全缺失信息，有疑问时提问 | 回答澄清问题（也可以让它自己推断） |
| **制定计划** | 产出分步实现方案，包含涉及文件、风险评估、验收标准 | 审阅方案，批准后进入下一步 |
| **实现代码** | 按照批准的计划编写代码 | 可以实时查看进度（自动进行） |
| **代码评审** | 检查代码质量、一致性和回归风险 | 查看评审结果，决定是否需要修改 |
| **测试验证** | 执行验证并报告通过/失败结果及证据 | 查看测试结果 |

如果评审发现问题，工作流会自动回到实现阶段重做（最多循环 3 次）。如果测试失败，会暂停等你决策。

如果 develop / review / test 阶段看起来已经结束，但当前阶段的 artifact 仍然保持模板态，Autopilot 会在升级为人工阻塞前，额外补发一次 **仅修复 artifact** 的派发。这次派发只允许更新 artifact，不允许继续修改业务代码。

## 聊天式 Autopilot 指令

Autopilot 支持少量私有 inline directives，可以直接写在正常聊天输入里。这些指令由 Autopilot 自己解析，**不是** OpenCode 宿主的 slash command。

支持的指令：

```text
/ap-doc: docs/requirement.md
/ap-start-at: develop
```

示例：

```text
1. 修改商品列表文案
2. 调整主按钮颜色
/ap-doc: docs/requirement.md
/ap-start-at: develop
```

```text
/ap-doc: local_docs/figma_md/page.md
```

规则：

- `/ap-doc:` 会把文档作为显式 workflow 参考文档加入 workflow-open 输入。
- `/ap-start-at: develop` 会显式跳过需求精炼和制定计划，直接从 `develop` 开始新 workflow。
- 这两个指令需要单独占一行。
- 普通正文里的 `startAt: develop` 只会被当成普通文本，**不会**被解释成控制指令。
- direct-develop workflow 仍然保留 review/test 的质量护栏，并会在状态中记录 refinement/plan 被跳过。

## 工作流恢复

如果 workflow 停在 `review` 或 `test`，而你又在 workflow 外手动改了代码，请使用 `workflow_resync` 重新对齐当前 worktree 与 workflow 状态。

行为说明：

- `workflow_resync` 是一个独立的恢复命令/工具。
- 当前只支持停在 `review` 或 `test` 的 workflow。
- 它会把当前阶段 artifact 重置为新的重跑基线，然后重新派发同一阶段。
- 默认行为是**重跑当前阶段**，不是沿用旧结论直接继续。

一个典型的恢复流程：

```text
1. workflow 停在 review 或 test。
2. 你在 workflow 外手动修了代码。
3. 如有需要先 attach 或看 status。
4. 对同一个 workflowId 执行 workflow_resync。
5. Autopilot 重建当前阶段基线，并重新跑这一阶段。
```

常见使用顺序：

```text
workflow_status -> workflow_resync -> workflow_attach
```

## 配置说明

Autopilot 使用两个配置文件：

| 级别 | 路径 | 用途 |
|---|---|---|
| 全局（所有项目共用） | `~/.config/opencode/autopilot.json` | 你的个人默认配置 |
| 项目级（当前项目专属） | `你的项目/.workflow-harness/autopilot.json` | 针对当前项目的定制配置 |

两个文件同时存在时，配置会**合并**（项目级覆盖/补充全局级）。如果都不存在，Autopilot 在首次运行时自动创建一份带默认值的配置。**也就是说，不配任何东西也能直接用。**

### 显式 `@read(...)` 读取源

Autopilot 支持在 workflow-open 请求中显式声明读取目标。

例如：

```text
请使用 @read(docs/acceptance.md) 作为验收标准来源。
购买页面的 “video generate” 标题下，增加 @read(local_docs/figma_md/17786586547155.png) 中的内容。
```

规则：

- `@read(...)` 只在 **需求精炼** 和 **制定计划** 阶段生效。
- 普通路径如果没有 `@read(...)`，不会被自动读取。
- 文本类目标（`.md`, `.txt`, `.rst`, `.adoc`）会直接读取内容并注入 workflow 输入。
- 图片类目标（`.png`, `.jpg`, `.jpeg`, `.webp`）会走图片摘要服务。

### 图片摘要服务行为

图片 `@read(...)` 只有在配置了 OpenAI 兼容视觉服务时，才会真正生成摘要。环境变量如下：

```bash
export AUTOPILOT_IMAGE_SUMMARY_BASE_URL="https://your-openai-compatible-endpoint"
export AUTOPILOT_IMAGE_SUMMARY_API_KEY="your-api-key"
export AUTOPILOT_IMAGE_SUMMARY_MODEL="your-vision-model"
```

配置后：

- 每次请求最多读取 **5** 张显式图片
- 并发度为 **2**
- 单张图片超时 **5 分钟**
- 成功时会把 `READ_TARGET_IMAGE_SUMMARY` 注入 refinement / plan 输入

未配置时：

- 系统会退回到 `NoopImageSummaryService`
- 注入 `READ_TARGET_IMAGE_ERROR`
- 不阻塞 workflow
- 不会编造图片内容

### autopilot.json 完整示例

下面是一份完整的配置文件，每项都有注释说明：

```jsonc
{
  // ---- Skill 搜索目录 ----
  // Autopilot 会扫描这些目录下的 .md 文件作为 Skill
  // 支持 ~ 开头（表示用户主目录），目录不存在会被静默跳过
  "skillRoots": [
    "~/.claude/skills",
    "~/.config/opencode/skills"
  ],

  // ---- 各阶段设置 ----
  // 每个阶段可以配置：
  //   requiredSkills：该阶段要启用的 Skill 名称列表
  //   understandingDepth：AI 对项目的理解深度（lightweight / standard / deep）
  "phases": {
    "refinement": {
      "requiredSkills": [],
      "understandingDepth": "lightweight"
    },
    "plan": {
      "requiredSkills": [],
      "understandingDepth": "standard"
    },
    "develop": {
      "requiredSkills": [],
      "understandingDepth": "deep"
    },
    "review": {
      "requiredSkills": [],
      "understandingDepth": "deep"
    },
    "test": {
      "requiredSkills": [],
      "understandingDepth": "standard"
    }
  },

  // ---- 风险信号 ----
  // 当请求中检测到这些模式时，理解深度会自动升级
  // 标记了 triggersDeep: true 的信号会强制切换到 deep 模式
  "riskSignals": [
    { "id": "cross_module", "description": "修改涉及多个模块或包", "triggersDeep": true },
    { "id": "public_component", "description": "修改了被其他功能使用的公共组件", "triggersDeep": true },
    { "id": "state_route_permission", "description": "涉及状态管理、路由或权限逻辑" },
    { "id": "dependency_chain", "description": "需要追踪父组件、导入链或依赖图" },
    { "id": "history_complexity", "description": "该区域历史上复杂度高、Bug 多或回归多", "triggersDeep": true }
  ]
}
```

### 理解深度 —— 三个级别分别是什么意思？

| 深度 | 行为 | 默认用于哪些阶段 |
|---|---|---|
| **轻量 (lightweight)** | 只提取核心意图，不做深层依赖追踪。保持快速聚焦。 | 需求精炼阶段——还在定义"做什么" |
| **标准 (standard)** | 追踪直接依赖、父组件和即时影响范围。兼顾效率和完整性。 | 计划 & 测试阶段——足够上下文来规划和验证 |
| **深入 (deep)** | 全面追踪：父组件、路由、状态管理、服务、共享模块、API 契约、状态流、跨模块影响。动代码前拿到完整图景。 | 实现 & 评审阶段——写代码/改代码时的最大安全保障 |

> 深度可以**自动升级**：如果你的请求触发了某个风险信号（比如检测到"跨模块修改"），即使是默认轻量的阶段也会被提升。简单需求保持快速，复杂需求得到充分处理——全自动。

### 什么是 Skill（技能）？

Skill 就是一份 **Markdown 格式的指南文件**，用来告诉 AI 在某个工作流阶段应该遵循什么规则、参考什么规范。

你可以把它理解为**给 AI 的备忘录**——比如"写代码优先用我们自己的 Button 组件"、"遵循团队的命名规范"、"UI 改动要用 Playwright 做浏览器测试"。

#### Skill 文件放在哪里？

Skill 文件放在 `skillRoots` 配置的目录中。支持两种格式：

| 格式 | 示例 | 适用场景 |
|---|---|---|
| 单文件 | `~/.config/opencode/skills/my-rule.md` | 规则较短，一个文件能写完 |
| 目录 + SKILL.md | `~/.config/opencode/skills/playwright/SKILL.md` | 规则较长，需要附带参考资料文件 |

**命名规则**：单文件格式的 Skill 名称 = 文件名去掉 `.md` 后缀；目录格式的 Skill 名称 = 目录名。

#### 创建你的第一个 Skill

假设你想让 AI 在开发阶段遵循你们团队的前端规范：

**第 1 步：** 创建 skill 目录（如果还没有的话）：

```bash
mkdir -p ~/.config/opencode/skills
```

**第 2 步：** 创建一个 skill 文件：

```markdown
# 前端开发规范

## 组件使用
- 优先使用 src/components/ 中已有的组件，不要重复造轮子。
- Button 组件从 "@/components/Button/Button.tsx" 导入。
- Table 组件从 "@/components/Table/Table.tsx" 导入。

## 样式
- 使用 Tailwind CSS 工具类，不要新建 CSS 文件。
- 遵循 src/styles/tokens.ts 中的设计令牌。

## 无障碍
- 所有可交互元素必须添加 aria-label。
- 自定义组件必须支持键盘导航。
```

将这个文件保存为 `~/.config/opencode/skills/frontend-design.md`。

**第 3 步：** 在配置中启用它：

```json
{
  "phases": {
    "develop": {
      "requiredSkills": ["frontend-design"]
    }
  }
}
```

从此以后，每次工作流进入**实现**阶段，AI 都会把这份开发规范当作上下文，按照里面的规则来写代码。

#### 实用 Skill 示例

| Skill 名称 | 推荐用于阶段 | 作用 |
|---|---|---|
| `frontend-design` | develop | 注入组件库使用规范和样式约定 |
| `code-review-checklist` | review | 保证每次评审都遵循一致的检查标准 |
| `playwright` | test | 引导 AI 编写基于浏览器的端到端测试 |
| `clarity-guide` | refinement | 引导 AI 在早期主动消除歧义 |
| `i18n-rules` | develop | 强制遵守国际化代码规范 |

#### Skill 找不到会怎样？

如果你在 `requiredSkills` 里填了一个名称，但所有 `skillRoots` 目录下都没有对应文件，Autopilot 会在工作流提示中标注 `[MISSING_SKILLS]`，但**不会中断流程**，正常继续运行。

## 更新 Autopilot

支持两种更新入口：

### 方式 1：CLI 更新

如果你想在 OpenCode 对话之外主动刷新插件，可以执行：

```bash
bun run src/cli.ts update
```

也支持这个别名：

```bash
bun run src/cli.ts autopilot-update
```

### 方式 2：OpenCode 工具更新

在 OpenCode 内请使用独立维护工具 `autopilot_update`。

- 它**不是** `workflow_*` 命令。
- 它**不属于** `workflow_channel`。
- 它**不会进入**任何 workflow 生命周期或状态机。

如果你是在和 agent 对话，明确要求它**调用 `autopilot_update`**，会比只发送字符串 `autopilot_update` 更稳妥。

### 更新器会做什么

- **本地源码安装（`file://<repo>/dist/plugin.js`）**：会检查仓库版本，只有落后于最新 release 时才重新构建。
- **release 文件安装（`file://~/.config/opencode/plugins/autopilot/plugin.js`）**：会下载最新 GitHub release，并安全替换本地安装目录。
- **npm 包安装（`@fkqfkq123/opencode-autopilot`）**：会读取当前已安装版本，并在需要时提示你执行 `npm update @fkqfkq123/opencode-autopilot`。

### 更新后要做什么

- 只要真的发生了更新，就建议你重启 OpenCode，让内存中的插件缓存重新加载新代码。
- 如果更新器提示你已经是最新版本，则不需要重启。

## 发布到 npm

这个包已经按 public scoped package 的方式配置。

### 本地发布前检查

```bash
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

### 手动发布

```bash
npm publish --access public
```

### GitHub Actions 自动发布

给仓库打 `v*` tag 会触发 `.github/workflows/release.yml`，执行：

- typecheck
- build
- smoke test
- 上传 GitHub release 压缩包
- 如果仓库里配置了 `NPM_TOKEN` secret，则自动发布到 npm

注意：GitHub Release 的版本也要和 npm 包版本保持同步。如果 npm 已经发布了更高版本，但 latest GitHub Release 还是旧版本，那么 file/release 安装模式看到的 latest 版本信息会过期。

### 还差最后一个前提

如果你想把它真正作为公开开源包发布，还需要补上明确的许可证：

- `package.json` 里的 `license`
- 仓库根目录下的 `LICENSE`

否则 npm 元数据层面仍会把它视为 proprietary。

## 常见问题

### 加了插件后 OpenCode 启动失败

先从 `opencode.json` 里临时删掉这行插件配置，确认 OpenCode 能正常启动，再检查拼写后重新加回来。

### 工作流卡住或状态异常

删除运行时目录，重新开始：

```bash
rm -rf .workflow-harness
```

然后重新发起你的需求即可。

### 插件加载了但看不到 workflow 命令

请确认你的 OpenCode 版本支持插件命令。可以尝试更新插件到最新版：

```bash
npm update @fkqfkq123/opencode-autopilot
```

## 备用安装方式

如果你想从源码本地安装而不是通过 npm：

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```
