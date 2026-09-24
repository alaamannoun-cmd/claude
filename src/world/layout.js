// World layout: road loop, river, lake, landmarks. All units in meters.
// +X east, +Z south, -Z north (Mount Fuji lies far to the north).

export const WORLD_HALF = 1000; // detailed terrain spans [-1000, 1000]
export const PLAY_HALF = 640; // the bike is kept inside this square
export const GRID_STEP = 2;
export const GRID_N = WORLD_HALF * 2 / GRID_STEP + 1; // 1001
export const WATER_LEVEL = 0;
export const ROAD_HALF_WIDTH = 2.7;

export const LAKE_CENTER = { x: 20, z: -478 };
// Lake shore radius as a smooth function of angle (atan2(z - cz, x - cx)).
export function lakeRadius(theta) {
  return 196 + 34 * Math.sin(2 * theta + 0.6) + 18 * Math.sin(3 * theta - 1.1) + 9 * Math.cos(5 * theta + 0.3);
}

export const FUJI = { x: -520, z: -5600, height: 1850, radius: 3600 };

export const PAGODA = { x: -372, z: -368 };
export const SHRINE = { x: -262, z: 150 };

// River control points (south -> north, ending inside the lake)
export const RIVER_POINTS = [
  [-300, 1060],
  [-230, 820],
  [-200, 700],
  [-128, 540],
  [-50, 392],
  [-70, 230],
  [-12, 86],
  [-42, -58],
  [16, -176],
  [18, -262],
  [22, -330],
  [24, -420],
];

// Road loop control points (counter-clockwise seen from above, starting on the east river bank).
// The lake-shore stretch sits ~30 m outside the lake radius so the road hugs the water.
export function roadControlPoints() {
  const pts = [
    [22, 480],
    [10, 388],
    [-14, 300],
    [-22, 222],
    [8, 146],
    [34, 84],
    [26, -8],
    [8, -70],
    [40, -142],
    [86, -196],
  ];
  for (let deg = 75; deg <= 150; deg += 15) {
    const th = (deg * Math.PI) / 180;
    const r = lakeRadius(th) + 30;
    pts.push([LAKE_CENTER.x + Math.cos(th) * r, LAKE_CENTER.z + Math.sin(th) * r]);
  }
  pts.push(
    [-232, -352],
    [-285, -302],
    [-330, -250],
    [-352, -190],
    [-346, -112],
    [-334, -30],
    [-318, 50],
    [-306, 132],
    [-318, 212],
    [-332, 292],
    [-306, 384],
    [-250, 456],
    [-190, 520],
    [-132, 552],
    [-64, 566],
    [0, 548]
  );
  return pts;
}

// Named places for the HUD location banner. Radius in meters.
export const PLACES = [
  { id: 'avenue', ar: 'ممرّ أشجار الساكورا', jp: '桜並木', x: 10, z: 200, r: 170 },
  { id: 'nanohana', ar: 'حقول النانوهانا الصفراء', jp: '菜の花畑', x: 110, z: 330, r: 110 },
  { id: 'lake', ar: 'بحيرة فوجي', jp: '富士の湖', x: -40, z: -330, r: 150 },
  { id: 'bridge', ar: 'الجسر الأحمر', jp: '赤い橋', x: 18, z: -300, r: 40 },
  { id: 'pagoda', ar: 'تلّة الباغودا', jp: '五重塔', x: -340, z: -330, r: 70 },
  { id: 'bamboo', ar: 'غابة الخيزران', jp: '竹林', x: -345, z: -120, r: 85 },
  { id: 'torii', ar: 'ممرّ بوابات التوري', jp: '千本鳥居', x: -310, z: 98, r: 55 },
  { id: 'village', ar: 'قرية الحقول', jp: '田舎の村', x: -330, z: 320, r: 110 },
  { id: 'shibazakura', ar: 'بساط الشيبازاكورا', jp: '芝桜', x: -200, z: 560, r: 100 },
];

// Village buildings. Each faces the nearest point of the road.
export const HOUSES = [
  { x: -296, z: 238, type: 'minka', w: 9, d: 7 },
  { x: -300, z: 272, type: 'minka', w: 10, d: 7.5 },
  { x: -292, z: 314, type: 'kura', w: 6, d: 5 },
  { x: -278, z: 352, type: 'thatch', w: 11, d: 8 },
  { x: -357, z: 250, type: 'minka', w: 9, d: 7 },
  { x: -362, z: 300, type: 'thatch', w: 12, d: 8.5 },
  { x: -352, z: 342, type: 'minka', w: 8.5, d: 7 },
  { x: -246, z: 420, type: 'minka', w: 9, d: 7 },
];

// Terraced rice paddies west of the village: rows x cols of plots.
export const PADDIES = { x0: -452, z0: 214, cols: 3, rows: 7, pw: 25, pd: 18, gap: 1.2 };
