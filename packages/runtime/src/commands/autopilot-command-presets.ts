import { AUTOPILOT_PRESET_BRIDGE_PROMPT, type AutopilotPresetMode, getAutopilotPresetDefinition } from "./autopilot-presets"

export type AutopilotCommandPreset = AutopilotPresetMode

export const AUTOPILOT_COMMAND_BRIDGE_PROMPT = AUTOPILOT_PRESET_BRIDGE_PROMPT

type BuildAutopilotCommandPayloadArgs = {
  preset: AutopilotCommandPreset
  prompt: string
}

export function buildAutopilotCommandPayload(args: BuildAutopilotCommandPayloadArgs): string {
  const preset = getAutopilotPresetDefinition(args.preset)
  const lines = [
    preset.bridge.prompt,
    args.prompt.trim(),
    `/ap-mode: ${args.preset}`,
  ]

  if (preset.bridge.startAtDevelop) {
    lines.push("/ap-start-at: develop")
  }

  return lines.join("\n")
}
