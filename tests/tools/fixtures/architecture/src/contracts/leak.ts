// Fixture: a contracts/ file importing outward breaks the vocabulary leaf rule, like types/bad.ts.
import type { Shape } from '../export/shape';

export interface Contract { shape: Shape }
// …and a ?query import: no edge, but vocabulary holds no asset or worker.
export { default as dataUrl } from '../utils/data.txt?url';
