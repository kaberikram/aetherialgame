import { toonMaterial } from '../render/npr/ToonMaterial.js';

/**
 * The blockout palette.
 *
 * Grey box does not mean grey. Each zone gets a small, deliberately separated
 * set of values so the chapter still reads as three places — and so the
 * grayscale check (`PROJECT.md` critic rubric: "if a frame does not read in
 * grayscale, it fails") is answerable now rather than after an art pass.
 *
 * Value structure first, hue second. Every surface below is picked so that
 * floor, wall and detail sit at visibly different luminances *within* a zone,
 * because that separation is what a silhouette reads against. The hue is what
 * tells the zones apart from each other.
 *
 * Everything here is cached by `toonMaterial`, so the whole chapter draws from
 * roughly a dozen materials sharing one program.
 */

export const PALETTE = {
  // --- shared -------------------------------------------------------------
  /** Anything walkable that no zone has claimed. Mid value, neutral. */
  floor: () => toonMaterial({ color: 0x6f7379, bands: 3, rimStrength: 0.28 }),
  /** Structural walls. A stop darker than the floor, always. */
  wall: () => toonMaterial({ color: 0x4a4e55, bands: 3, rimStrength: 0.34 }),
  /** Ceilings and anything meant to disappear. */
  shell: () => toonMaterial({ color: 0x33373d, bands: 3, rimStrength: 0.22 }),
  /** Steps, ledges, and anything the player is meant to read as standable. */
  ledge: () => toonMaterial({ color: 0x878c93, bands: 3, rimStrength: 0.42 }),

  // --- descent ------------------------------------------------------------
  descentFloor: () => toonMaterial({ color: 0x6d7479, bands: 3, rimStrength: 0.3 }),
  descentWall: () => toonMaterial({ color: 0x434a4e, bands: 3, rimStrength: 0.32 }),

  // --- green vein ---------------------------------------------------------
  // Warm olive walls against cold jade water. The board's warmth is in the
  // rock, not in the light, which is why the walls are the warm element here.
  veinFloor: () => toonMaterial({ color: 0x7a6a4c, bands: 3, rimStrength: 0.3 }),
  veinWall: () => toonMaterial({ color: 0x4c4632, bands: 3, rimStrength: 0.36 }),
  veinJade: () => toonMaterial({
    color: 0x1f9c72, bands: 2, rim: 0x7fffd8, rimStrength: 1.0, rimPower: 1.6,
    transparent: true, opacity: 0.72,
  }),

  // --- star chamber -------------------------------------------------------
  // Pale flowstone, not black. The falloff in the concept board happens inside
  // a narrow band from a pale wall down to dark steps — the wall is light.
  chamberWall: () => toonMaterial({ color: 0x8d93a6, bands: 3, rimStrength: 0.4 }),
  chamberStep: () => toonMaterial({ color: 0x4b5162, bands: 3, rimStrength: 0.34 }),
  chamberBasin: () => toonMaterial({ color: 0x3a4052, bands: 3, rimStrength: 0.26 }),
  chamberWater: () => toonMaterial({
    color: 0x1c2740, bands: 2, rim: 0x8fb4ff, rimStrength: 0.85, rimPower: 2.2,
    transparent: true, opacity: 0.78,
  }),
  star: () => toonMaterial({
    color: 0xf2f6ff, bands: 1, rim: 0xffffff, rimStrength: 1.4, rimPower: 1.2,
  }),

  // --- pagoda well --------------------------------------------------------
  pagodaStone: () => toonMaterial({ color: 0x9a9384, bands: 3, rimStrength: 0.44 }),
  pagodaShaft: () => toonMaterial({ color: 0x5b5f63, bands: 3, rimStrength: 0.3 }),
  pagodaTower: () => toonMaterial({ color: 0xb0a68f, bands: 4, rimStrength: 0.5 }),
  // The oculus. Flat and unfogged — it is a hole onto sky, not a surface, and
  // fogging it would tint the one patch of outside in the chapter with the
  // colour of the room it is being seen from.
  sky: () => toonMaterial({ color: 0xbfd8ea, bands: 1, rimStrength: 0, fog: false }),

  // --- props --------------------------------------------------------------
  bone: () => toonMaterial({ color: 0xd8d2c0, bands: 3, rimStrength: 0.5 }),
  wood: () => toonMaterial({ color: 0x6b5138, bands: 3, rimStrength: 0.36 }),
  steel: () => toonMaterial({ color: 0xa8b0b8, bands: 4, rimStrength: 0.7, rimPower: 3.2 }),
  /** Interactables. One value nothing else in the chapter occupies. */
  marker: () => toonMaterial({ color: 0xc4a04a, bands: 3, rimStrength: 0.8, rimPower: 2.0 }),
};

/** Resolves the whole palette to materials once, for a ZoneBuilder to hold. */
export function buildPalette() {
  const out = {};
  for (const [name, make] of Object.entries(PALETTE)) out[name] = make();
  return out;
}
