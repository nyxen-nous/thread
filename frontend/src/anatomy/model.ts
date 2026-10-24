// One timeline drives the pieces, screen progress and completion state.
export const TRANSFER_START = 4.6;
export const TRANSFER_END = 10.6;
export const TOUR_LENGTH = 14;
const COUNT = 6, STAGGER = .65, TRAVEL = 2.2;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function sampleTransfer(time: number) {
  const t = Math.max(0, time);
  const phase = t < 2.4 ? 0 : t < TRANSFER_START ? 1 : t < TRANSFER_END ? 2 : 3;
  const elapsed = t - TRANSFER_START;
  const pieces = Array.from({ length: COUNT }, (_, i) => {
    const at = clamp((elapsed - i * STAGGER) / TRAVEL);
    return { at, opacity: phase === 2 ? Math.min(clamp(at / .12), clamp((1 - at) / .12)) : 0 };
  });
  const arrived = pieces.filter(p => p.at === 1).length;
  const progress = phase < 2 ? 0 : phase === 3 ? 1 : clamp(elapsed / ((COUNT - 1) * STAGGER + TRAVEL));
  return { phase, pieces, arrived, progress, complete: phase === 3 };
}
export function onCurve(curve: readonly (readonly number[])[], t: number) {
  const u = 1-t;
  return [0,1].map(axis => u*u*u*curve[0][axis]+3*u*u*t*curve[1][axis]+3*u*t*t*curve[2][axis]+t*t*t*curve[3][axis]);
}
