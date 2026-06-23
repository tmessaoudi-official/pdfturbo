import type { Command } from './command';

export class MacroCmd implements Command {
  constructor(private cmds: Command[]) {}
  execute(): void {
    // Atomic: if a child throws, roll back the already-applied prefix (reverse) so a partial
    // macro never leaves corrupt state, then re-throw (#QA-2026-06-23 P2).
    const applied: Command[] = [];
    try {
      for (const c of this.cmds) { c.execute(); applied.push(c); }
    } catch (e) {
      for (const c of applied.reverse()) { try { c.undo(); } catch { /* best-effort rollback */ } }
      throw e;
    }
  }
  undo(): void {
    const applied: Command[] = [];
    try {
      for (const c of [...this.cmds].reverse()) { c.undo(); applied.push(c); }
    } catch (e) {
      for (const c of applied.reverse()) { try { c.execute(); } catch { /* best-effort rollback */ } }
      throw e;
    }
  }
  // When a macro leaves the history stack for good, each child also becomes unreachable —
  // forward dispose so resource-owning children (e.g. ReplaceSourcePdfBytesCmd) are freed.
  dispose(): void { this.cmds.forEach(c => c.dispose?.()); }
}
