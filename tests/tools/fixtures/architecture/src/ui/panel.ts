// Fixture: closes a runtime cycle with core/app.ts, and reads one private app member (app._ ratchet).
import { app } from '../core/app';

export type { Shape } from '../export/shape';

// app._ghost — a comment, not counted
export const panel = (): number => app._hidden;
