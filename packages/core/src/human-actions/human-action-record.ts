import type { HumanAction } from "./human-action"

export type HumanActionStatus =
  | "pending"
  | "presented"
  | "responded"
  | "consumed"

export interface HumanActionRecord {
  id: string
  workflowId: string
  action: HumanAction
  status: HumanActionStatus
  createdAt: string
  respondedAt?: string
}
