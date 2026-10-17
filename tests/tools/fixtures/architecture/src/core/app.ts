// Fixture for tests/tools/architecture.test.ts — every import form the scanner must classify.
// import { ghost } from '../ui/ghost';
/* import { ghost2 } from '../ui/ghost2'; */
import { panel } from '../ui/panel';
import type { Shape } from '../export/shape';
import { type Tool } from '../types/tool';

export { renderAll } from '../export/render';

const quoted = 'import { nope } from "../ui/nope"';
const commentOpener = /\/\*/;

export const app = { _hidden: 1, panel, quoted, commentOpener, tool: null as Tool | null, shape: null as Shape | null };

export async function lazy(): Promise<number> {
  return (await import('../ui/lazy')).lazyValue;
}
