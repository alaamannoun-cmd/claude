// Quality presets. The game picks one at start and can step down automatically if the frame rate drops.
export const QUALITY = {
  high: {
    name: 'high',
    label: 'عالية',
    pixelRatio: 1.5,
    shadowSize: 4096,
    shadowExtent: 75,
    reflections: true,
    reflectionScale: 0.5,
    grassRings: 3,
    grassDensity: 1,
    flowerDistance: 260,
    bloom: true,
    msaa: 4,
    petals: 2600,
  },
  medium: {
    name: 'medium',
    label: 'متوسطة',
    pixelRatio: 1.15,
    shadowSize: 2048,
    shadowExtent: 60,
    reflections: true,
    reflectionScale: 0.35,
    grassRings: 2,
    grassDensity: 0.6,
    flowerDistance: 180,
    bloom: true,
    msaa: 2,
    petals: 1500,
  },
  low: {
    name: 'low',
    label: 'منخفضة',
    pixelRatio: 0.85,
    shadowSize: 1024,
    shadowExtent: 45,
    reflections: false,
    reflectionScale: 0.25,
    grassRings: 1,
    grassDensity: 0.35,
    flowerDistance: 120,
    bloom: false,
    msaa: 0,
    petals: 700,
  },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export function detectQuality() {
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 4) return 'medium';
  return 'high';
}
