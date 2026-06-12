import type { Command } from './commands/command';

// Re-export everything so existing importers keep working unchanged
export type { Command } from './commands/command';
export * from './commands/elementCmds';
export * from './commands/moveCmds';
export * from './commands/pageCmds';
export * from './commands/inkCmds';
export * from './commands/sourcePdfCmds';
export * from './commands/macroCmds';

export class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(
    private maxSize: number,
    private onChange: (canUndo: boolean, canRedo: boolean) => void
  ) {}

  execute(cmd: Command): void {
    cmd.execute();
    this._push(cmd);
  }

  record(cmd: Command): void {
    this._push(cmd);
  }

  private _push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(true, false);
  }

  undo(): boolean {
    if (!this.undoStack.length) return false;
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.onChange(this.undoStack.length > 0, true);
    return true;
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.onChange(true, this.redoStack.length > 0);
    return true;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange(false, false);
  }
}
