// Scatter Plot & Bubble Risk Matrix Geometry Helper Utilities

export function toX(pct, W = 600, PAD = 58) {
  const num = Number(pct || 0);
  const clamped = Math.min(140, Math.max(0, num));
  return PAD + (clamped / 140) * (W - 2 * PAD);
}

export function toY(pct, H = 380, PAD = 58) {
  const num = Number(pct || 0);
  const clamped = Math.min(100, Math.max(0, num));
  return H - PAD - (clamped / 100) * (H - 2 * PAD);
}

export function calcBubbleRadius(days) {
  const d = Number(days || 0);
  return Math.min(20, Math.max(5, 6 + d / 4));
}

export function getQuadrantLabel(xPct, yPct) {
  const x = Number(xPct || 0);
  const y = Number(yPct || 0);

  if (x >= 50 && y >= 50) return 'ON TRACK';
  if (x < 50 && y >= 50) return 'EFFICIENT';
  if (x < 50 && y < 50) return 'DORMANT';
  return 'CRITICAL OVERRUN';
}
