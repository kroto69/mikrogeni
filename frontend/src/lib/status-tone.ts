export type NmsStatus =
  | "online"
  | "offline"
  | "down"
  | "warning"
  | "critical"
  | "disabled"
  | "provisioning"
  | "pending"
  | "success"
  | "error"
  | "unknown";

export type NmsStatusTone = {
  label: string;
  className: string;
};

/**
 * Wave 0 visual foundation for NMS status semantics.
 * - Uses token-driven classes only (no raw hex / ad-hoc utility palettes).
 * - Keeps strong neobrutalist baseline (border-2, square edges, readable contrast).
 */
export const NMS_STATUS_TONES: Record<NmsStatus, NmsStatusTone> = {
  online: {
    label: "ONLINE",
    className: "border-border bg-success text-success-foreground",
  },
  offline: {
    label: "OFFLINE",
    className: "border-border bg-destructive text-destructive-foreground",
  },
  down: {
    label: "DOWN",
    className: "border-border bg-destructive text-destructive-foreground",
  },
  warning: {
    label: "WARNING",
    className: "border-border bg-warning text-warning-foreground",
  },
  critical: {
    label: "CRITICAL",
    className: "border-border bg-destructive text-destructive-foreground",
  },
  disabled: {
    label: "DISABLED",
    className: "border-border bg-muted text-muted-foreground",
  },
  provisioning: {
    label: "PROVISIONING",
    className: "border-border bg-complementary text-complementary-foreground",
  },
  pending: {
    label: "PENDING",
    className: "border-border bg-secondary text-secondary-foreground",
  },
  success: {
    label: "SUCCESS",
    className: "border-border bg-success text-success-foreground",
  },
  error: {
    label: "ERROR",
    className: "border-border bg-destructive text-destructive-foreground",
  },
  unknown: {
    label: "UNKNOWN",
    className: "border-border bg-secondary text-secondary-foreground",
  },
};

export function getNmsStatusTone(status: NmsStatus): NmsStatusTone {
  return NMS_STATUS_TONES[status] ?? NMS_STATUS_TONES.unknown;
}
