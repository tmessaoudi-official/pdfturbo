// Fixture: a kernel file breaking both kernel rules (an src/ import, an npm package off the allowlist).
import { unzipSync } from 'fflate';
import type { BidiApi } from 'bidi-js';
import { app } from '../core/app';

export const kernel = { unzipSync, app, bidi: null as BidiApi | null };
