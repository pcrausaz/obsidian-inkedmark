/**
 * Per-tool stroke style (pure — no DOM, no Obsidian).
 *
 * The pen and the highlighter each keep their own color and size (#34): the
 * toolbar's swatches and size buttons show and edit the style of the tool in
 * hand, and a stroke takes the style of the tool that draws it — including a
 * highlighter picked by a stylus button. The eraser and select tools draw
 * nothing; they show (and edit) the pen's style.
 */

/** The style fields of the toolbar state (`ToolbarState` extends this). */
export interface ToolStyleState {
  /** Pen color (also what eraser/select show). */
  color: string;
  /** Pen size (also what eraser/select show). */
  size: number;
  highlighterColor: string;
  highlighterSize: number;
}

export interface ToolStyle {
  color: string;
  size: number;
}

/** The color and size `tool` draws (or the toolbar shows) with. */
export function toolStyle(state: ToolStyleState, tool: string): ToolStyle {
  return tool === "highlighter"
    ? { color: state.highlighterColor, size: state.highlighterSize }
    : { color: state.color, size: state.size };
}

/** Set the color and/or size of `tool`'s style in `state` (mutates `state`). */
export function setToolStyle(state: ToolStyleState, tool: string, patch: Partial<ToolStyle>): void {
  if (tool === "highlighter") {
    if (patch.color !== undefined) state.highlighterColor = patch.color;
    if (patch.size !== undefined) state.highlighterSize = patch.size;
  } else {
    if (patch.color !== undefined) state.color = patch.color;
    if (patch.size !== undefined) state.size = patch.size;
  }
}
