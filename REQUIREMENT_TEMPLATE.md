# Requirement Template

> Purpose: use this file as a requirement input template for Autopilot workflows.  
> Principle: **incomplete input is acceptable**, **missing sections are acceptable**, and **plain natural language is acceptable**.  
> During `spec_refinement`, Autopilot should infer what is safe to infer and only ask follow-up questions when something is genuinely ambiguous.

---

## How to use this template

You can use this document in either of these ways:

1. **Minimal mode** — only fill in the title and the raw request, then let Autopilot refine the rest.
2. **Structured mode** — fill in as many sections as possible for higher-quality planning, execution, review, and testing.

Autopilot can also accept:

- plain natural language in `workflow_open`
- one or more document paths via `docPaths`
- extra project notes via `projectContext`

This template is intended to work well with all of those inputs.

---

## 1. Request Title *(required)*

<!-- Example: Add filter and sorting to the product list page -->

## 2. Raw Request *(required)*

<!-- The original request in plain language. Keep it natural. -->

## 3. Background / Why this matters

<!-- Business reason, user pain point, product motivation, technical reason, or any context explaining why this work is needed. -->

## 4. Desired Outcome

<!-- What should be true after this work is done? Include business, user, product, or engineering outcomes if known. -->

## 5. Non-goals / Out of scope

<!-- Explicitly list what should NOT be included in this iteration. -->

## 6. Target Users / Scenarios

<!-- Who will use this? In which context or workflow? -->

## 7. Functional Requirements

<!-- List functional requirements. They do not need to be complete. -->

- Requirement 1:
- Requirement 2:
- Requirement 3:

## 8. Affected Pages / Modules / Entry Points

<!-- Pages, routes, menus, dialogs, APIs, modules, components, CLI commands, or other entry points involved. -->

## 9. Interaction / Behavior Notes

<!-- User actions, state transitions, workflow expectations, validation behavior, edge behavior, etc. -->

## 10. UI / Content / Presentation Notes

<!-- Optional UI, copywriting, layout, loading/empty/error states, responsive behavior, accessibility, etc. -->

## 11. Data / API / State Notes

<!-- Fields, API endpoints, query params, state management, persistence, caching, data shape, migration concerns, etc. -->

## 12. Roles / Permissions / Visibility

<!-- Whether different users/roles should see or do different things. -->

## 13. Constraints

<!-- Technical constraints, compatibility requirements, deadlines, host constraints, restricted files, required patterns, or other non-negotiables. -->

## 14. Known Impact Area

<!-- Existing pages, modules, commands, flows, or behaviors that are likely to be affected. -->

## 15. Regression Risks *(important)*

<!-- What existing behavior are you worried this change may break? -->

- Existing behavior at risk 1:
- Existing behavior at risk 2:
- Existing behavior at risk 3:

## 16. Acceptance Criteria *(strongly recommended)*

<!-- What counts as done? These can be incomplete; refinement can improve them. -->

- [ ] Acceptance item 1
- [ ] Acceptance item 2
- [ ] Acceptance item 3

## 17. Test Focus

<!-- What should testing pay special attention to? Include new behavior and impacted existing behavior. -->

- Test focus 1:
- Test focus 2:
- Test focus 3:

## 18. Related Documents / References

<!-- Add file paths, links, design docs, PRDs, API docs, screenshots, issue links, or examples. -->

- Requirement doc path:
- Design reference:
- API reference:
- Example implementation:

## 19. Optional Structured `workflow_open` Payload

<!-- Use this only if you prefer structured input. -->

```json
{
  "prompt": "Implement the requirement described in REQUIREMENT_TEMPLATE.md and start the full workflow.",
  "docPaths": [
    "REQUIREMENT_TEMPLATE.md"
  ],
  "projectContext": "This plugin is for OpenCode-style workflow execution. Preserve workflow command compatibility and review regression risks carefully."
}
```

## 20. Additional Notes

<!-- Any information that does not fit the sections above. -->

---

## Minimum input required

In practice, you only need these 2 sections to start a workflow:

1. `Request Title`
2. `Raw Request`

Everything else may be left blank.

Autopilot should follow this rule:

- **Safe to infer** → infer and fill during `spec_refinement`
- **Unsafe to infer** → ask a clarification question instead of guessing

That means:

- if you are short on time, title + raw request is enough
- if you also provide background, acceptance criteria, impact, and regression risks, the workflow quality will usually be much better

---

## Recommended prompt to start the workflow

After filling this file, you can say something like:

```txt
The requirement document is in REQUIREMENT_TEMPLATE.md (or in the actual path I filled in). Start the full workflow.
If information is missing, infer and refine what is safe during spec_refinement, and only ask me when something is truly ambiguous.
Please pay special attention to regression risks and impacted existing behavior.
```
