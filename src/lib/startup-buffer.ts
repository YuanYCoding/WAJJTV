/** A bounded startup cushion, never an unbounded pause/rebuffer loop. */
export function startupBufferReady(ahead: number, duration: number, elapsed: number) { return ahead >= 8 || Number.isFinite(duration) && duration > 0 && ahead >= duration - .25 || elapsed >= 12_000; }
