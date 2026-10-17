// Fixture: a contracts/ file importing outward breaks the vocabulary leaf rule, like types/bad.ts.
import type { Shape } from '../export/shape';

export interface Contract { shape: Shape }
