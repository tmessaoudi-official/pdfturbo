import type { Command } from './command';

export class MacroCmd implements Command {
  constructor(private cmds: Command[]) {}
  execute(): void { this.cmds.forEach(c => c.execute()); }
  undo(): void { [...this.cmds].reverse().forEach(c => c.undo()); }
}
