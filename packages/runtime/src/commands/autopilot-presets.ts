export type AutopilotPresetMode = "light" | "standard" | "safe" | "debug" | "review-heavy" | "verify" | "ap-goal"

type AutopilotCommandName = "ap-goal" | `ap-${Exclude<AutopilotPresetMode, "ap-goal">}`

export type AutopilotPresetDefinition = {
  mode: AutopilotPresetMode
  commandName: AutopilotCommandName
  description: string
  runtimePolicy: {
    refine?: string
    plan?: string
    develop?: string
    review?: string
    test?: string
    understandingDepth?: "lightweight" | "standard" | "deep"
    forceDeepReviewAndTest?: boolean
    reviewRoles?: Array<{
      name: string
      focus: string
      priority?: number
      weight?: number
      mustReport?: string[]
    }>
    summaryRules?: string[]
  }
  bridge: {
    prompt: string
    startAtDevelop: boolean
  }
}

export const AUTOPILOT_PRESET_BRIDGE_PROMPT = "请启动 Autopilot workflow，并按下面的请求执行。"

export const AUTOPILOT_PRESET_DEFINITIONS: Record<AutopilotPresetMode, AutopilotPresetDefinition> = {
  light: {
    mode: "light",
    commandName: "ap-light",
    description: "Quick develop mode: skip refine/plan and enter develop directly",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: true,
    },
    runtimePolicy: {
      understandingDepth: "lightweight",
    },
  },
  standard: {
    mode: "standard",
    commandName: "ap-standard",
    description: "Standard workflow mode: balanced depth with normal review and verify",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: false,
    },
    runtimePolicy: {
      understandingDepth: "deep",
      review: "[PRESET_REVIEW_POLICY] In standard mode, ensure the review covers requested behavior, directly impacted dependencies, and realistic regression checks, but keep the review proportional to the actual change scope.",
      test: "[PRESET_TEST_POLICY] In standard mode, verify the primary flow plus the most likely impacted existing behavior. Keep the test report concise but evidence-based.",
      reviewRoles: [
        {
          name: "Business Reviewer",
          focus: "Check whether the requested behavior is actually implemented and whether direct dependencies were handled correctly.",
          priority: 2,
          weight: 60,
          mustReport: ["requested behavior", "direct dependencies", "gaps"],
        },
      ],
      summaryRules: ["Deduplicate issues across reviewers.", "Always end with one pass/fail conclusion.", "List unresolved disagreement explicitly."] ,
    },
  },
  safe: {
    mode: "safe",
    commandName: "ap-safe",
    description: "Strict workflow mode: keep full flow with stronger review and verification",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: false,
    },
    runtimePolicy: {
      understandingDepth: "deep",
      forceDeepReviewAndTest: true,
      review: "[PRESET_REVIEW_POLICY] In safe mode, apply stricter review standards: enumerate assumptions explicitly, attempt to falsify the implementation, inspect neighboring dependencies and fallback/error paths, and fail the review when evidence is incomplete for non-trivial risk areas.",
      test: "[PRESET_TEST_POLICY] In safe mode, strengthen verification depth: cover primary flow, regression paths, boundary/error handling, and document any unverified areas explicitly instead of assuming pass coverage.",
      reviewRoles: [
        {
          name: "Business Reviewer",
          focus: "Check feature correctness, acceptance coverage, and request alignment.",
          priority: 1,
          weight: 40,
          mustReport: ["acceptance coverage", "request alignment"],
        },
        {
          name: "Edge Reviewer",
          focus: "Probe boundary conditions, fallback behavior, null/empty states, and failure handling.",
          priority: 2,
          weight: 35,
          mustReport: ["boundary conditions", "failure handling"],
        },
        {
          name: "Quality Reviewer",
          focus: "Inspect maintainability, regression risk, dependency-tracing gaps, and code quality concerns.",
          priority: 3,
          weight: 25,
          mustReport: ["regression risk", "dependency-tracing gaps", "maintainability"],
        },
      ],
      summaryRules: ["Deduplicate issues across reviewers.", "Do not allow a single reviewer to hide unresolved high-risk concerns.", "One consolidated review artifact only."],
    },
  },
  debug: {
    mode: "debug",
    commandName: "ap-debug",
    description: "Debug workflow mode: focus on reproducing, tracing, fixing, and verifying bugs",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: false,
    },
    runtimePolicy: {
      understandingDepth: "deep",
      review: "[PRESET_REVIEW_POLICY] In debug mode, review whether the reported symptom is actually addressed, whether the root-cause reasoning is credible, whether the fix is narrower than necessary, and whether nearby failure modes remain exposed.",
      test: "[PRESET_TEST_POLICY] In debug mode, verify the original failing scenario first, then confirm the fix does not regress adjacent behavior. Call out whether the bug was reproduced directly, inferred from evidence, or only partially validated.",
      refine: "[PRESET_REFINEMENT_POLICY] In debug mode, identify the user-visible symptom, suspected trigger conditions, expected vs actual behavior, and available reproduction clues. If reproduction details are missing, ask only for the minimum information needed to isolate the bug.",
      plan: "[PRESET_PLAN_POLICY] In debug mode, structure the plan around reproduce -> isolate -> fix -> verify. Prefer the smallest fix that addresses the root cause, and explicitly call out why nearby plausible causes were ruled in or ruled out.",
      develop: "[PRESET_DEVELOP_POLICY] In debug mode, keep changes narrowly targeted to the proven fault path. Avoid opportunistic cleanup unless it is required for the fix. Record the root cause and why the chosen fix addresses it directly.",
      reviewRoles: [
        {
          name: "Root-Cause Reviewer",
          focus: "Check whether the fix matches a credible root cause instead of only masking symptoms.",
          priority: 1,
          weight: 55,
          mustReport: ["root cause", "symptom coverage"],
        },
        {
          name: "Regression Reviewer",
          focus: "Check whether nearby bug surfaces or previously working flows may still break after the fix.",
          priority: 2,
          weight: 45,
          mustReport: ["adjacent regressions", "previously working flows"],
        },
      ],
      summaryRules: ["Prefer direct reproduction evidence.", "Call out uncertainty explicitly.", "Keep the report narrow and bug-focused."],
    },
  },
  "review-heavy": {
    mode: "review-heavy",
    commandName: "ap-review-heavy",
    description: "Review-heavy workflow mode: emphasize deeper review scrutiny before test completion",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: false,
    },
    runtimePolicy: {
      understandingDepth: "deep",
      forceDeepReviewAndTest: true,
      review: "[PRESET_REVIEW_POLICY] In review-heavy mode, spend extra effort on defect discovery, assumption checking, dependency-tracing gaps, edge cases, and regression exposure before concluding review pass.",
      test: "[PRESET_TEST_POLICY] In review-heavy mode, ensure test verification explicitly covers every review concern that was investigated or ruled out.",
      reviewRoles: [
        {
          name: "Business Reviewer",
          focus: "Check feature correctness and product requirement alignment.",
          priority: 1,
          weight: 40,
          mustReport: ["product requirement alignment"],
        },
        {
          name: "Edge Reviewer",
          focus: "Try to break the change with edge cases, missing states, and error paths.",
          priority: 2,
          weight: 35,
          mustReport: ["edge cases", "error paths"],
        },
        {
          name: "Quality Reviewer",
          focus: "Inspect maintainability, clarity, dependency-tracing completeness, and future regression risk.",
          priority: 3,
          weight: 25,
          mustReport: ["future regression risk", "dependency-tracing completeness"],
        },
      ],
      summaryRules: ["Favor deeper scrutiny over brevity.", "Merge duplicate findings carefully.", "State whether evidence is sufficient for a confident pass."],
    },
  },
  verify: {
    mode: "verify",
    commandName: "ap-verify",
    description: "Verify workflow mode: emphasize validation evidence, regression checks, and test conclusions",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: false,
    },
    runtimePolicy: {
      understandingDepth: "standard",
      refine: "[PRESET_REFINEMENT_POLICY] In verify mode, clarify only the minimum information needed to judge pass/fail outcomes. Avoid broad requirement expansion or speculative feature discovery.",
      plan: "[PRESET_PLAN_POLICY] In verify mode, keep the plan verification-oriented: define what will be checked, what evidence is required, and which regressions matter. Avoid widening implementation scope unless verification would otherwise be unreliable.",
      develop: "[PRESET_DEVELOP_POLICY] In verify mode, avoid unnecessary implementation expansion. Prefer the smallest change set that enables reliable validation and preserves observability of pass/fail results.",
      test: "[PRESET_TEST_POLICY] In verify mode, bias the workflow toward validation evidence: confirm requested behavior, impacted regressions, remaining uncertainty, and concrete pass/fail rationale with minimal speculative expansion.",
      review: "[PRESET_REVIEW_POLICY] In verify mode, keep review concise and validation-oriented, focusing on whether the implementation is testable, observable, and ready for confident verification.",
      reviewRoles: [
        {
          name: "Verification Reviewer",
          focus: "Check whether the implementation is observable, testable, and ready for confident pass/fail validation.",
          priority: 1,
          weight: 100,
          mustReport: ["observability", "testability", "pass/fail validation"],
        },
      ],
      summaryRules: ["Keep the final report concise.", "Report only evidence relevant to verification.", "State remaining uncertainty clearly."],
    },
  },
  "ap-goal": {
    mode: "ap-goal",
    commandName: "ap-goal",
    description: "Goal-closing workflow mode: keep refine/plan human-gated, then auto-loop develop/review/test until pass",
    bridge: {
      prompt: AUTOPILOT_PRESET_BRIDGE_PROMPT,
      startAtDevelop: false,
    },
    runtimePolicy: {
      understandingDepth: "deep",
      forceDeepReviewAndTest: true,
      refine: "[PRESET_REFINEMENT_POLICY] In ap-goal mode, ask only the minimum clarification needed to define a concrete success target and non-negotiable constraints before the autonomous execution loop begins.",
      plan: "[PRESET_PLAN_POLICY] In ap-goal mode, produce a concrete execution plan that is directly actionable for repeated implement -> review -> test closure loops. Make regression scope and acceptance checkpoints explicit.",
      develop: "[PRESET_DEVELOP_POLICY] In ap-goal mode, treat every return from review/test as an explicit repair loop. Fix the reported gaps directly, preserve request alignment, and keep iterating toward a final pass state instead of stopping for manual review decisions.",
      review: "[PRESET_REVIEW_POLICY] In ap-goal mode, review rigorously and report concrete fixable findings. If the implementation is not ready, fail explicitly with actionable evidence so the workflow can route back to develop automatically.",
      test: "[PRESET_TEST_POLICY] In ap-goal mode, verify requested behavior and regressions rigorously. If validation fails or remains inconclusive, state the failure explicitly with actionable evidence so the workflow can route back to develop automatically.",
      reviewRoles: [
        {
          name: "Goal Reviewer",
          focus: "Check whether the current implementation is actually sufficient to close the original goal, including regressions and missing acceptance evidence.",
          priority: 1,
          weight: 100,
          mustReport: ["goal closure", "regression risk", "missing evidence"],
        },
      ],
      summaryRules: ["Always end with one explicit PASS or FAIL conclusion.", "When failing, provide directly actionable findings for the next develop loop.", "Do not stop at ambiguity if a concrete deficiency can be stated."],
    },
  },
}

export function isAutopilotPresetMode(value: string): value is AutopilotPresetMode {
  return value === "light"
    || value === "standard"
    || value === "safe"
    || value === "debug"
    || value === "review-heavy"
    || value === "verify"
    || value === "ap-goal"
}

export function getAutopilotPresetDefinition(mode: AutopilotPresetMode): AutopilotPresetDefinition {
  return AUTOPILOT_PRESET_DEFINITIONS[mode]
}
