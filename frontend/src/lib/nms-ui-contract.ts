/**
 * Wave 0 NMS UI contract (shared baseline only).
 *
 * This file intentionally captures style guardrails before page-level refactors:
 * - Radius baseline: 0.5rem (tokenized via --radius, applied as rounded-lg).
 * - Theme source of truth: CSS variables/tokens from index.css + tailwind.config.ts.
 * - Border baseline: strong borders (border-2) for neobrutalist readability.
 * - Status semantics: centralized through src/lib/status-tone.ts.
 * - Reuse policy: prefer shared NMS components over per-page status color maps.
 * - Palette semantics:
 *     --success: #18b573 (UP/online green, hsl 155 77% 40%)
 *     --destructive: #d1112e (LOS/down red, hsl 351 85% 44%)
 *     --warning: #F07200 (orange, hsl 29 100% 47%)
 *     --complementary: #589D77 (muted green accent, hsl 147 28% 48% — provisioning/active)
 */
export const NMS_UI_CONTRACT = {
  radiusBaseline: "0.5rem",
  preferTokenizedColors: true,
  borderStrength: "strong",
  avoidMixedLargeRadiusByDefault: true,
  centralizeStatusToneMap: true,
  preferSharedNmsComponents: true,
} as const;

export type NmsUiContract = typeof NMS_UI_CONTRACT;