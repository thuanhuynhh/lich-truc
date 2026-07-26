export const SWAP_AUDIT_ACTIONS = ["move", "accept_swap", "reject_swap"] as const;

export function getAuditActionValues(filter: string): readonly string[] {
  return filter === "swap" ? SWAP_AUDIT_ACTIONS : [filter];
}
