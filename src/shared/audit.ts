/** Hành động khoa phòng tự điền hoặc sửa người làm việc. */
export const PERSON_AUDIT_ACTIONS = ["fill_person", "update_person"] as const;

/** Hành động thuộc luồng đổi ngày làm của điều phối. */
export const SWAP_AUDIT_ACTIONS = ["request_swap", "accept_swap", "reject_swap", "move_coordinator"] as const;

export function getAuditActionValues(filter: string): readonly string[] {
  if (filter === "person") return PERSON_AUDIT_ACTIONS;
  if (filter === "swap") return SWAP_AUDIT_ACTIONS;
  return [filter];
}
