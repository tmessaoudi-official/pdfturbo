// Fixture: a multi-line brace list with one untyped specifier is a runtime import.
import {
  type Tool,
  toolName,
} from '../types/tool';

export const lazyValue: number = toolName.length;
export const lazyTool: Tool = 'pen';
