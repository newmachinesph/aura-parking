// Keep in sync with billing.ts (cannot import — billing.ts pulls in pg which breaks client bundles)
export const FREE_PASS_DAYS = 1; // = FREE_NIGHTS_PER_RESIDENT_PER_MONTH
export const RATE_PER_DAY = 5; // = RATE_CENTS_PER_NIGHT (500) / 100

export const STATUS_COLORS = {
  success: "#27ae60",
  warning: "#f39c12",
  danger: "#e74c3c",
  info: "#3498db",
  primary: "#765276",
} as const;
