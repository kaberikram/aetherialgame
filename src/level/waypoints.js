import * as THREE from 'three';

/**
 * The chapter's shared coordinate truth.
 *
 * Lives in its own module rather than in Chapter1 so the zone modules can
 * import it without importing the composer that imports them. Re-exported from
 * Chapter1.js, which is where the rest of the project already gets it.
 */

/**
 * The Green Vein's floor height as a function of depth along the chapter's
 * axis. Exported so the waypoints, the checkpoints and the level geometry
 * cannot disagree about where the ground is.
 */
export const GREEN_VEIN_FLOOR = (z) => -14 - ((2 - z) / 56) * 7.6;

/**
 * The whole path in one descending line, because the chapter's shape is a
 * descent: the player starts at the top and every zone is lower than the last
 * until the oculus, which is the only thing above them and the only daylight.
 *
 *   EMBODIMENT   y   0   z  +34   the ledge the body wakes on
 *   DESCENT      y −14   z  +4    sloping tunnel, traversal taught by geometry
 *   GREEN VEIN   y −19   z −34    the bioluminescent stretch, and the sword
 *   STAR CHAMBER y −23   z −78    the flooded dais
 *   PAGODA WELL  y −25   z −126   the sunken candi under open sky
 *
 * Scale is held against the concept board: the candi is 26m tall and the well
 * chamber is 58m from floor to oculus, so a 1.68m player reads as a few pixels
 * against it — the ratio the board sets.
 */
export const WAYPOINTS = {
  embodiment: new THREE.Vector3(0, 0.1, 34),
  descentTop: new THREE.Vector3(0, 0, 26),
  descentBottom: new THREE.Vector3(0, -14, 4),
  greenVein: new THREE.Vector3(0, GREEN_VEIN_FLOOR(-20), -20),
  sword: new THREE.Vector3(7.5, GREEN_VEIN_FLOOR(-30), -30),
  poolApproach: new THREE.Vector3(0, GREEN_VEIN_FLOOR(-54) - 0.4, -55),
  starChamber: new THREE.Vector3(0, -23, -78),
  pagodaGate: new THREE.Vector3(0, -24, -101),
  pagodaWell: new THREE.Vector3(0, -25, -126),
  /** Standing spot at the base of the candi — the tower occupies the centre. */
  pagodaFloor: new THREE.Vector3(17, -25, -126),
};
