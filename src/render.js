import { state } from './state.js';
import { renderCircuit } from './tikz.js';
import { setupInteractiveSvg } from './interactive.js';
import { updateEditPanel } from './handlers.js';

export function hideInlineInput() {
  state.inputMode = null;
  state.activeContextId = null;
}

export function render() {
  hideInlineInput();
  updateEditPanel();
  renderCircuit(setupInteractiveSvg);
}