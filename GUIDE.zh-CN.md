# Autopilot

[English](./README.md) | 中文说明

Autopilot 是一个 OpenCode 插件，可以把自然语言需求推进成一套完整流程：需求精炼、计划、实现、评审和测试。

## 安装

在 OpenCode 配置里加入插件：

```json
{
  "plugin": ["@fkqfkq123/opencode-autopilot"]
}
```

然后重启 `opencode`。

如果加载成功，你应该看到类似日志：

```txt
[autopilot] Autopilot plugin loaded (... commands)
```

## 使用

直接输入自然语言需求，例如：

```txt
给商品列表页增加排序能力，并注意回归风险。
```

Autopilot 会通过这些工具推进流程：

- `workflow_open`
- `workflow_attach`
- `workflow_status`
- `workflow_answer`
- `workflow_approve`
- `workflow_resume`

通常你只需要按照 workflow 输出里提示的下一步工具继续即可。

## 配置

Autopilot 会在需要时自动创建：

```txt
.workflow-harness/autopilot.json
~/.config/opencode/autopilot.json
```

如果配置保持空值，就使用默认行为。

### `autopilot.json`

最小示例：

```json
{
  "skillRoots": ["~/.claude/skills", "~/.config/opencode/skills"],
  "phases": {
    "spec_refinement": { "requiredSkills": [] },
    "plan": { "requiredSkills": [] },
    "develop": { "requiredSkills": [] },
    "review": { "requiredSkills": [] },
    "test": { "requiredSkills": [] }
  }
}
```

字段说明：

- `skillRoots`：要扫描的 skill 目录
- `phases.<phase>.requiredSkills`：该阶段需要注入的 skill

支持的 phase：

- `spec_refinement`
- `plan`
- `develop`
- `review`
- `test`

如果旧的 `workflow.json` 存在而新的 `autopilot.json` 不存在，Autopilot 会复用旧文件，并提示你后续迁移。

## 备用安装方式

如果你更想走本地文件安装：

```bash
curl -fsSL https://raw.githubusercontent.com/juhuaxia/Autopilot/main/install.sh | bash
```

## 常见问题

### OpenCode 启动失败

先临时从 `opencode.json` 中移除这个插件，确认 OpenCode 能正常启动，再检查配置后重新启用。

### 插件加载了，但看不到 workflow 命令

通常是宿主没有正确注册导出的 workflow tools。

### 某个 workflow 状态坏掉了

删除当前项目的运行时目录后重新开始：

```bash
rm -rf .workflow-harness
```

## 如果你要开发这个插件

```bash
bun install
bun run typecheck
bun test
bun run build
```
