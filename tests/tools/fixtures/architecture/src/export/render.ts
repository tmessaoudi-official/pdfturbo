// Fixture: a side-effect import directly followed by another import — both edges must be found.
import '../ui/side';
import { toolName } from '../types/tool';

export function getDocument(): number {
  return toolName.length;
}

export const renderAll = (): number => getDocument();
