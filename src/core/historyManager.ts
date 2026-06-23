import type { Command } from './commands/command';

// Re-export everything so existing importers keep working unchanged
export type { Command } from './commands/command';
export * from './commands/elementCmds';
export * from './commands/moveCmds';
export * from './commands/pageCmds';
export * from './commands/inkCmds';
export * from './commands/sourcePdfCmds';
export * from './commands/macroCmds';
export * from './commands/formCmds';

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
    // Overflow: the oldest command falls off the undo branch and is unreachable forever.
    if (this.undoStack.length > this.maxSize) {
      const evicted = this.undoStack.shift();
      evicted?.dispose?.();
    }
    // A fresh push invalidates the redo branch: those commands can never be reached again.
    for (const stale of this.redoStack) stale.dispose?.();
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
    // Every command on both stacks is being discarded for good — release their resources.
    for (const cmd of this.undoStack) cmd.dispose?.();
    for (const cmd of this.redoStack) cmd.dispose?.();
    this.undoStack = [];
    this.redoStack = [];
    this.onChange(false, false);
  }
}
