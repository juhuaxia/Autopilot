export type Phase =
  | "spec_refinement"
  | "plan"
  | "develop"
  | "review"
  | "test"
  | "done"
  | "blocked"

export type WorkflowStatus =
  | "pending"
  | "in_progress"
  | "waiting_human"
  | "completed"
  | "blocked"
