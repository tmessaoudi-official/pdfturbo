import type { Command } from './command';

export class MacroCmd implements Command {
  constructor(private cmds: Command[]) {}
  execute(): void { this.cmds.forEach(c => c.execute()); }
  undo(): void { [...this.cmds].reverse().forEach(c => c.undo()); }
  // When a macro leaves the history stack for good, each child also becomes unreachable —
  // forward dispose so resource-owning children (e.g. ReplaceSourcePdfBytesCmd) are freed.
  dispose(): void { this.cmds.forEach(c => c.dispose?.()); }
}
