/**
 * Undo/redo stack of {@link Command}s (§5.3). Delta-based: memory is O(commands),
 * and each command stores only its own change, never a document snapshot.
 *
 * Pure: no DOM, no Obsidian.
 */

import type { Command } from "./commands";
import type { InkDocument } from "./document";

const DEFAULT_LIMIT = 200;

export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  constructor(private readonly limit: number = DEFAULT_LIMIT) {}

  /** Apply a new command and record it; clears the redo stack. */
  push(doc: InkDocument, command: Command): void {
    command.apply(doc);
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Invert the most recent command; returns it, or null if nothing to undo. */
  undo(doc: InkDocument): Command | null {
    const command = this.undoStack.pop();
    if (!command) return null;
    command.invert(doc);
    this.redoStack.push(command);
    return command;
  }

  /** Re-apply the most recently undone command; null if nothing to redo. */
  redo(doc: InkDocument): Command | null {
    const command = this.redoStack.pop();
    if (!command) return null;
    command.apply(doc);
    this.undoStack.push(command);
    return command;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
