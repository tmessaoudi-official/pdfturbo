export interface Command {
  execute(): void;
  undo(): void;
  // Called by HistoryManager when this command leaves the stack for good — i.e. it is
  // evicted by overflow, dropped when the redo stack is cleared, or wiped by clear().
  // It is NEVER called while the command is still reachable for undo/redo. Implementations
  // should release heavy resources they own (e.g. orphaned pdf.js documents) here, and
  // must be safe to call when absent (HistoryManager invokes it as `cmd.dispose?.()`).
  dispose?(): void;
}
