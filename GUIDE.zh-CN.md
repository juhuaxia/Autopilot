# Autopilot

[English](./README.md) | 中文说明

Autopilot 是一个面向 OpenCode 风格运行时的 **attached-session workflow harness**。它提供从需求精炼、计划、开发、评审到测试的 workflow runtime 骨架，以及可本地加载的插件、CLI 入口和诊断能力。

## 1. 这个项目提供什么

- 完整 workflow phase 主链：`spec_refinement -> plan -> develop -> review -> test -> done`
- 面向 OpenCode 的 workflow 命令：`workflow_open`、`workflow_attach`、`workflow_status`、`workflow_answer`、`workflow_approve`、`workflow_resume`、`workflow_back`
- OpenCode 风格宿主的插件加载能力与原生 primary workflow agent 注册能力
- `install` / `doctor` 初始化与自检流程
- review/test loop-back、人工断点、事件存储、attach / re-attach 支持

## 2. 适合谁使用

如果你希望：

- 在 OpenCode 风格宿主中接入 workflow 主代理
- 把工程流程拆成显式 phase
- 通过插件形式验证 workflow runtime 与 command surface

那么这个项目适合你。

## 3. 环境准备

建议环境：

- macOS / Linux / Windows
- [Bun](https://bun.sh/) `1.3.5` 或兼容版本
- 已安装 OpenCode（如果你需要实际加载并验证插件）

检查 Bun：

```bash
bun --version
```

如果还没有安装 Bun：

```bash
curl -fsSL https://bun.sh/install | bash
```

安装完成后重启终端，再执行：

```bash
bun --version
```

## 4. 安装

### 4.1 推荐方式：作为 npm 插件包安装

OpenCode 原生支持 npm 插件。等这个包发布后，最简单的配置方式是：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

也可以固定版本：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot@0.1.0"]
}
```

在这种模式下，OpenCode 会自动安装并缓存 npm 包，不需要手动 `git clone`、不需要本地 `plugin.js`、也不需要额外安装脚本。

### 4.2 备用方式：通过 GitHub Releases 安装

如果你更希望走本地文件安装路径，或者需要 fallback 分发方式，可以使用 GitHub Releases 一键安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```

安装指定版本：

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash -s -- --version v0.1.0
```

这个备用安装脚本会：

- 从 GitHub Releases 下载预构建发布包
- 安装到 `~/.config/opencode/plugins/autopilot/`
- 更新 `~/.config/opencode/opencode.json`

发布要求：

- 每个 GitHub Release 需要包含 `autopilot-release.tar.gz`
- 仓库内置 `.github/workflows/release.yml`，在推送 `v*` tag 时会自动构建并上传该文件

如果你想修改源码或从源码开发，继续看下面的源码安装流程。

### 4.3 克隆仓库

```bash
git clone https://github.com/juhuaxia/Autopilot.git
cd Autopilot
```

### 4.4 安装依赖

```bash
bun install
```

项目使用 `bun.lock`，依赖版本应保持可复现。

## 5. 推荐首次执行的命令

在项目根目录执行：

```bash
bun run src/cli.ts install
bun run src/cli.ts doctor
bun run build
```

它们分别会：

1. `install`
   - 创建项目级 `.workflow-harness/workflow.json`
   - 尝试安全写入 `~/.config/opencode/opencode.json`
   - 如有 `opencode.jsonc`，在安全情况下归一化写回 `opencode.json`
2. `doctor`
   - 检查 `workflow.json`
   - 检查 `skillRoots`
   - 检查各 phase 的 `requiredSkills`
   - 输出告警与缺失项
3. `build`
   - 编译 TypeScript
   - 生成 `dist/plugin.js`

之后建议确认：

- `.workflow-harness/workflow.json` 已生成
- `doctor` 没有阻断性配置问题
- `dist/plugin.js` 已生成

## 6. 常用开发命令

### 6.1 构建

```bash
bun run build
```

### 6.2 类型检查

```bash
bun run typecheck
```

### 6.3 运行测试

```bash
bun test
```

### 6.4 运行插件 smoke test

```bash
bun run smoke:plugin
```

### 6.5 直接运行 CLI

```bash
bun run src/cli.ts doctor
bun run src/cli.ts install
```

也可以通过脚本别名运行：

```bash
bun run cli --help
```

> CLI 主要用于 workflow 初始化、attach/status 流程以及 install/doctor 动作。

## 7. CLI 快速使用

### 7.1 初始化配置

```bash
bun run src/cli.ts install
```

### 7.2 做一次自检

```bash
bun run src/cli.ts doctor
```

### 7.3 创建一个 workflow

```bash
bun run src/cli.ts workflow-open wf-1
```

### 7.4 查看 workflow 状态

```bash
bun run src/cli.ts workflow-status wf-1
```

### 7.5 重新 attach 到 workflow channel

```bash
bun run src/cli.ts workflow-attach wf-1
```

## 8. 如何把插件加载到 OpenCode

### 8.0 推荐的 npm 插件方式

推荐的 OpenCode 配置：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

### 8.1 备用的 release 安装方式

如果你希望使用本地安装后的 fallback 插件，执行：

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```

默认安装位置：

```txt
~/.config/opencode/plugins/autopilot/
```

安装脚本会写入类似这样的插件入口：

```txt
file:///Users/<your-user>/.config/opencode/plugins/autopilot/plugin.js
```

### 8.2 源码开发方式

执行：

```bash
bun run src/cli.ts install
bun run src/cli.ts doctor
```

如果 installer 能安全改写 OpenCode 配置，通常不需要手工编辑。

> `install.sh` 面向 GitHub Releases 安装；项目内 installer 面向源码开发场景。

### 8.3 手工注册插件

OpenCode 配置通常在：

- `~/.config/opencode/opencode.json`
- 或 `~/.config/opencode/opencode.jsonc`

#### 方案 A：加载构建产物

先构建：

```bash
bun run build
```

然后在 OpenCode 配置中加入：

```json
{
  "plugin": [
    "file:///ABSOLUTE_PATH_TO_PROJECT/dist/plugin.js"
  ]
}
```

#### 方案 B：开发阶段直接加载源码

```json
{
  "plugin": [
    "file:///ABSOLUTE_PATH_TO_PROJECT/plugin.ts"
  ]
}
```

### 8.4 启动 OpenCode

交互模式：

```bash
opencode
```

Server 模式：

```bash
opencode serve
```

## 9. 加载成功后你应该看到什么

插件会暴露这些工具/命令：

- `workflow_channel`
- `workflow_open`
- `workflow_attach`
- `workflow_status`
- `workflow_answer`
- `workflow_approve`
- `workflow_resume`
- `workflow_back`
- `workflow_doctor`

推荐优先使用 split tools：

- `workflow_open`
- `workflow_attach`
- `workflow_status`
- `workflow_answer`
- `workflow_approve`
- `workflow_resume`
- `workflow_back`

典型加载日志：

```txt
[autopilot] Autopilot plugin loaded (... commands)
```

## 10. 目录结构

### 10.1 配置层级

- 用户默认：`~/.config/opencode/workflow.json`
- 项目级覆盖：`<repo>/.workflow-harness/workflow.json`
- 运行时状态：`<repo>/.workflow-harness/workflows/<workflowId>/`

### 10.2 各目录作用

- `src/` — CLI 入口与顶层源码
- `packages/runtime/` — workflow runtime 实现
- `tests/` — 测试
- `scripts/` — 辅助脚本
- `.workflow-harness/` — 运行时配置、状态与产物
- `dist/` — 构建输出

## 11. 最小 `workflow.json` 示例

先从完全中性的配置开始：

```json
{
  "skillRoots": ["~/.claude/skills", "~/.config/opencode/skills"],
  "phases": {
    "develop": { "requiredSkills": [] },
    "test": { "requiredSkills": [] }
  }
}
```

然后按项目需要添加 skill。以前端项目为例：

```json
{
  "skillRoots": ["~/.claude/skills", "~/.config/opencode/skills"],
  "phases": {
    "develop": { "requiredSkills": ["frontend-design"] },
    "test": { "requiredSkills": ["playwright"] }
  }
}
```

这个前端示例只是示例，workflow runtime 默认并不绑定前端。

建议：

- skill / profile 配置放在全局或项目级 `workflow.json`
- 不要把 skill 配置写到 `workflows/<workflowId>/`
- 新配置上线前先跑 `workflow_doctor` 或 CLI `doctor`

## 12. 常见问题

### Q1：`install` 无法改写 OpenCode 配置怎么办？

手工编辑 OpenCode 配置，把发布版插件路径或本地构建路径加入 `plugin` 数组。例如：

```json
{
  "plugin": [
    "file:///Users/<your-user>/.config/opencode/plugins/autopilot/plugin.js"
  ]
}
```

如果你是源码开发场景，也可以指向本地的 `dist/plugin.js`。

如果你使用 npm 插件模式，则只需要这样配置：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

### Q2：为什么 build 以后还是看不到 workflow 命令？

通常是宿主集成层还没有把导出的 `workflowCommands` 真正注册到宿主命令面板 / tool surface。

### Q3：我应该先验证什么？

建议先按这个顺序验证：

1. 宿主能导入插件文件
2. 宿主能调用默认导出
3. 宿主能收到一个 plugin-like 对象

不要一开始就先验证 UI。

### Q4：插件根入口有什么约束？

根入口 `plugin.ts` 应只暴露一个宿主可调用的默认导出，不要在根入口额外暴露内部 class 或 helper function。

## 13. 推荐阅读

| 文档 | 用途 |
|---|---|
| `README.md` | 安装、发布、使用总入口 |
| `WORKFLOW_SKILL_PROFILE_ARCHITECTURE_CN.md` | skill / profile 配置设计 |
| `OPENCODE_WORKFLOW_AGENT_GUIDE.md` | agent / tool 调用顺序 |
| `REQUIREMENT_TEMPLATE.md` | 需求输入模板 |

内部规划稿、验收草案、状态记录等可以保存在本地 `docs_internal/` 中，该目录默认已忽略。

## 14. 最快可用路径

如果你只想最快跑起源码开发环境：

```bash
bun install
bun run src/cli.ts install
bun run src/cli.ts doctor
bun run build
opencode
```

然后：

1. 确认 `.workflow-harness/workflow.json` 已生成
2. 确认 `dist/plugin.js` 已生成
3. 如果 OpenCode 没有自动加载插件，手工把 `file:///ABSOLUTE_PATH_TO_PROJECT/dist/plugin.js` 加到配置里
4. 在宿主中验证 `workflow_open`、`workflow_attach`、`workflow_status` 是否可见
