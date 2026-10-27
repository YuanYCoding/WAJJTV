export function resourceTier(v: { width?: number; height?: number }) {
  const wide = Math.max(v.width || 0, v.height || 0), narrow = Math.min(v.width || 0, v.height || 0);
  return wide >= 3840 && narrow >= 1500 ? '4K' : wide >= 1920 && narrow >= 750 ? '1080P' : 'other';
}
