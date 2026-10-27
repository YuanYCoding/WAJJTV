import { expect, it } from 'vitest';
import { startupBufferReady } from './startup-buffer';
it('waits for the startup cushion, accepts short clips and never blocks beyond the deadline', () => { expect(startupBufferReady(2, 1000, 2000)).toBe(false); expect(startupBufferReady(8, 1000, 2000)).toBe(true); expect(startupBufferReady(3.9, 4, 2000)).toBe(true); expect(startupBufferReady(2, 1000, 12000)).toBe(true); });
