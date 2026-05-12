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

## 配置说明

Autopilot 使用两个配置文件：

| 级别 | 路径 | 用途 |
|---|---|---|
| 全局（所有项目共用） | `~/.config/opencode/autopilot.json` | 你的个人默认配置 |
| 项目级（当前项目专属） | `你的项目/.workflow-harness/autopilot.json` | 针对当前项目的定制配置 |

两个文件同时存在时，配置会**合并**（项目级覆盖/补充全局级）。如果都不存在，Autopilot 在首次运行时自动创建一份带默认值的配置。**也就是说，不配任何东西也能直接用。**

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
