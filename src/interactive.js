import { state } from './state.js';
import { dom } from './main.js';
import { selectComponent, toggleSelectedNode, clearSelectedNodes, isActionableElement } from './handlers.js';

const GOLDEN_COLOR = '#e3b768';
const GOLDEN_BORDER = '#c9973f';
const GOLDEN_GLOW = 'drop-shadow(0 0 5px #e3b768)';
const HOVER_GLOW = 'drop-shadow(0 0 3px rgba(227, 183, 104, 0.8))';

function getTooltipOptionsAtPoint(svg, event, colorToMeta) {
  const options = new Map();
  const elements = document.elementsFromPoint(event.clientX, event.clientY);

  elements.forEach(element => {
    if (!svg.contains(element)) return;
    const targetEl = element.hasAttribute('data-color-key') 
      ? element 
      : element.closest('[data-color-key]');
    if (!targetEl) return;

    const colorKey = targetEl.getAttribute('data-color-key');
    const meta = colorKey ? colorToMeta[colorKey] : null;
    if (!meta) return;

    const nodeRef = targetEl.getAttribute('data-node-ref') || meta.nodeRef;
    if (!nodeRef) return;

    if (!options.has(nodeRef)) {
      const displayLabel = meta.label ? `${nodeRef} (${meta.label})` : nodeRef;
      options.set(nodeRef, { 
        nodeRef, 
        colorKey: meta.color || colorKey, 
        label: displayLabel 
      });
    }
  });

  return [...options.values()];
}

let tooltipHideTimer = null;

function hideNodeTooltips(nodeTooltip) {
  if (!nodeTooltip || nodeTooltip.dataset.frozen === 'true') return;
  nodeTooltip.replaceChildren();
  nodeTooltip.style.display = 'none';
}

export function clearTooltips() {
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }
  ['nodeTooltip', 'secondNodeTooltip'].forEach(id => {
    const tooltip = document.getElementById(id);
    if (!tooltip) return;
    tooltip.dataset.frozen = 'false';
    tooltip.replaceChildren();
    tooltip.style.display = 'none';
  });
}

function showTooltips(nodeTooltip, options, event, frozen = false) {
  if (!nodeTooltip || !options.length) return;

  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  nodeTooltip.dataset.frozen = frozen ? 'true' : 'false';
  nodeTooltip.replaceChildren();
  options.forEach(option => {
    const tooltip = document.createElement('button');
    tooltip.type = 'button';
    tooltip.className = 'node-tooltip-option';
    tooltip.textContent = option.label;
    tooltip.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
      resolveNodeSelection(nodeTooltip, option, clickEvent);
    });
    nodeTooltip.appendChild(tooltip);
  });

  nodeTooltip.style.left = `${event.clientX + 8}px`;
  nodeTooltip.style.top = `${event.clientY + 8}px`;
  nodeTooltip.style.display = 'flex';
}

// Pick = blue "add flow" selection, Edit = gold component-edit selection.
function pickNode(nodeRef) {
  selectComponent(null);
  toggleSelectedNode(nodeRef);
}

function editNode(colorKey) {
  clearSelectedNodes();
  selectComponent(colorKey);
}

// Actionable nodes let the user choose Edit vs Pick; others are pick-only.
function resolveNodeSelection(nodeTooltip, nodeOption, event) {
  if (!nodeOption?.nodeRef) return;
  if (isActionableElement(nodeOption.colorKey)) {
    showActionTooltip(nodeTooltip, nodeOption, event);
  } else {
    pickNode(nodeOption.nodeRef);
    clearTooltips();
  }
}

function showActionTooltip(nodeTooltip, nodeOption, event) {
  if (!nodeTooltip) return;
  if (tooltipHideTimer) {
    clearTimeout(tooltipHideTimer);
    tooltipHideTimer = null;
  }

  nodeTooltip.dataset.frozen = 'true';
  nodeTooltip.replaceChildren();

  const addOption = (label, onSelect) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'node-tooltip-option';
    btn.textContent = label;
    btn.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
      onSelect();
      clearTooltips();
    });
    nodeTooltip.appendChild(btn);
  };

  addOption('Pick', () => pickNode(nodeOption.nodeRef));
  addOption('Edit', () => editNode(nodeOption.colorKey));

  nodeTooltip.style.left = `${event.clientX + 8}px`;
  nodeTooltip.style.top = `${event.clientY + 8}px`;
  nodeTooltip.style.display = 'flex';
}

export function normalizeColor(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (s === 'none' || s === 'transparent' || s === '') return null;

  let m = s.match(/^#?([0-9a-f]{6})$/i);
  if (m) return m[1].toLowerCase();

  m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();

  m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/);
  if (m) {
    return [1, 2, 3]
      .map(i => Math.max(0, Math.min(255, parseInt(m[i], 10))).toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase();
  }

  return s.toLowerCase();
}

export function setupInteractiveSvg(svg) {
  if (!svg) return;

  const colorMap = state.colorMap || {};
  if (!Object.keys(colorMap).length) return;
  const nodeTooltip = document.getElementById('nodeTooltip');
  const secondNodeTooltip = document.getElementById('secondNodeTooltip');

  // Background click deselects
  svg.onclick = (e) => {
    if (e.target === svg || e.target.tagName.toLowerCase() === 'svg') {
      clearTooltips();
      selectComponent(null);
      clearSelectedNodes();
    }
  };

  if (nodeTooltip) {
    nodeTooltip.onmouseenter = () => {
      if (tooltipHideTimer) {
        clearTimeout(tooltipHideTimer);
        tooltipHideTimer = null;
      }
    };
    nodeTooltip.onmouseleave = () => {
      hideNodeTooltips(nodeTooltip);
    };
  }

  // Map normalized original keys, updated meta.color, and displayColor -> meta object
  const colorToMeta = {};
  Object.entries(colorMap).forEach(([color, meta]) => {
    const normKey = normalizeColor(color);
    if (normKey) colorToMeta[normKey] = meta;
    if (meta?.color) {
      const normMetaColor = normalizeColor(meta.color);
      if (normMetaColor) colorToMeta[normMetaColor] = meta;
    }
    if (meta?.displayColor) {
      const normDisplayColor = normalizeColor(meta.displayColor);
      if (normDisplayColor) colorToMeta[normDisplayColor] = meta;
    }
  });

  const elementsByColor = {};
  const leafElements = svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, text, tspan, image, use');

  leafElements.forEach(el => {
    if (el.closest('defs')) return;

    let colorKey = null;

    // 1. Inspect direct and inherited presentation attributes
    for (const attr of ['stroke', 'fill', 'color']) {
      const val = el.getAttribute(attr) || el.closest(`[${attr}]`)?.getAttribute(attr);
      if (val) {
        const norm = normalizeColor(val);
        if (norm && colorToMeta[norm]) {
          colorKey = norm;
          break;
        }
      }
    }

    // 2. Inspect computed styles if attribute match missing
    if (!colorKey) {
      try {
        const cs = window.getComputedStyle(el);
        const strokeNorm = normalizeColor(cs.stroke);
        if (strokeNorm && colorToMeta[strokeNorm]) {
          colorKey = strokeNorm;
        } else {
          const fillNorm = normalizeColor(cs.fill);
          if (fillNorm && colorToMeta[fillNorm]) {
            colorKey = fillNorm;
          } else {
            const colorNorm = normalizeColor(cs.color);
            if (colorNorm && colorToMeta[colorNorm]) {
              colorKey = colorNorm;
            }
          }
        }
      } catch (e) {}
    }

    if (colorKey && colorToMeta[colorKey]) {
      if (!elementsByColor[colorKey]) elementsByColor[colorKey] = [];
      elementsByColor[colorKey].push(el);
    }
  });

  // Attach direct interactive behaviors to mapped SVG path elements
  Object.entries(elementsByColor).forEach(([colorKey, elements]) => {
    const meta = colorToMeta[colorKey];
    if (!meta) return;

    elements.forEach(el => {
      let strokeVal = el.getAttribute('stroke') || el.style.stroke;
      let fillVal = el.getAttribute('fill') || el.style.fill;
      if (!strokeVal && !fillVal) {
        try {
          const cs = window.getComputedStyle(el);
          strokeVal = cs.stroke;
          fillVal = cs.fill;
        } catch (e) {}
      }

      const hasStroke = Boolean(strokeVal && strokeVal !== 'none' && strokeVal !== 'transparent');
      const hasFill = Boolean(fillVal && fillVal !== 'none' && fillVal !== 'transparent');

      el.dataset.hasStroke = hasStroke || (!hasStroke && !hasFill) ? 'true' : 'false';
      el.dataset.hasFill = hasFill ? 'true' : 'false';

      // Apply initial manual/revert display color if present
      const displayColor = meta.displayColor ? `#${meta.displayColor}` : null;
      el.dataset.displayColor = meta.displayColor || '';
      if (displayColor) {
        if (el.dataset.hasStroke === 'true') el.style.stroke = displayColor;
        if (el.dataset.hasFill === 'true') {
          el.style.fill = displayColor;
          el.style.fillOpacity = '1.0';
        }
      }

      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'all';
      el.style.transition = 'fill 0.15s ease, stroke 0.15s ease, filter 0.15s ease';

      el.setAttribute('data-color-key', colorKey);

      if (meta.nodeRef) {
        el.setAttribute('data-node-ref', String(meta.nodeRef));
        const defaultLabel = meta.label ? `${meta.nodeRef} (${meta.label})` : meta.nodeRef;
        const activeColorKey = meta.color || colorKey;

        el.addEventListener('mouseenter', (event) => {
          if (nodeTooltip?.dataset.frozen === 'true') return;
          if (tooltipHideTimer) {
            clearTimeout(tooltipHideTimer);
            tooltipHideTimer = null;
          }
          const options = getTooltipOptionsAtPoint(svg, event, colorToMeta);
          showTooltips(nodeTooltip, options.length ? options : [{ nodeRef: meta.nodeRef, colorKey: activeColorKey, label: defaultLabel }], event);
        });
        el.addEventListener('mousemove', (event) => {
          if (nodeTooltip?.dataset.frozen === 'true') return;
          if (tooltipHideTimer) {
            clearTimeout(tooltipHideTimer);
            tooltipHideTimer = null;
          }
          const options = getTooltipOptionsAtPoint(svg, event, colorToMeta);
          showTooltips(nodeTooltip, options.length ? options : [{ nodeRef: meta.nodeRef, colorKey: activeColorKey, label: defaultLabel }], event);
        });
        el.addEventListener('mouseleave', () => {
          if (nodeTooltip?.dataset.frozen === 'true') return;
          if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
          tooltipHideTimer = setTimeout(() => {
            hideNodeTooltips(nodeTooltip);
          }, 150);
        });
      }

      // Hover feedback directly on the element
      el.addEventListener('mouseenter', () => {
        if (el.dataset.selected === 'true' || el.dataset.pickedNode === 'true') return;
        if (el.dataset.hasStroke === 'true') el.style.stroke = GOLDEN_COLOR;
        if (el.dataset.hasFill === 'true') {
          el.style.fill = GOLDEN_COLOR;
          el.style.fillOpacity = '1.0';
        }
        el.style.filter = HOVER_GLOW;
      });

      el.addEventListener('mouseleave', () => {
        if (el.dataset.selected === 'true' || el.dataset.pickedNode === 'true') return;
        const revertColor = el.dataset.displayColor ? `#${el.dataset.displayColor}` : '';
        if (el.dataset.hasStroke === 'true') el.style.stroke = revertColor;
        if (el.dataset.hasFill === 'true') {
          el.style.fill = revertColor;
          el.style.fillOpacity = revertColor ? '1.0' : '';
        }
        el.style.filter = '';
      });

      // Selection & device modal trigger
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const options = getTooltipOptionsAtPoint(svg, e, colorToMeta);
        const defaultLabel = meta.label ? `${meta.nodeRef} (${meta.label})` : meta.nodeRef;
        const activeColorKey = meta.color || colorKey;

        // Multiple overlapping nodes - let the user choose which node first.
        if (options.length > 1) {
          showTooltips(nodeTooltip, options, e, true);
          return;
        }

        // Prefer the clicked element's own node (works for non-actionable
        // nodes too); fall back to the point scan when a component's hit
        // area is on top of the node.
        const nodeOption = meta.nodeRef
          ? { nodeRef: meta.nodeRef, colorKey: activeColorKey, label: defaultLabel }
          : options[0] || null;

        if (nodeOption) {
          resolveNodeSelection(nodeTooltip, nodeOption, e);
          return;
        }

        selectComponent(activeColorKey);
        clearTooltips();
      });

      if (!meta.nodeRef) {
        const hitArea = el.cloneNode(true);
        hitArea.removeAttribute('data-color-key');
        hitArea.removeAttribute('data-node-ref');
        hitArea.classList.add('component-hit-area');
        hitArea.style.fill = 'transparent';
        hitArea.style.stroke = 'transparent';
        hitArea.style.strokeWidth = '14';
        hitArea.style.fillOpacity = '1';
        hitArea.style.strokeOpacity = '0';
        hitArea.style.pointerEvents = 'all';
        hitArea.style.cursor = 'pointer';
        hitArea.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          el.dispatchEvent(new MouseEvent('click', event));
        });
        hitArea.addEventListener('mouseenter', () => el.dispatchEvent(new MouseEvent('mouseenter')));
        hitArea.addEventListener('mouseleave', () => el.dispatchEvent(new MouseEvent('mouseleave')));
        el.parentNode?.insertBefore(hitArea, el);
      }
    });
  });

  // Re-apply selection state to SVG paths
  if (state.selectedComponentColor) {
    applySelectionHighlight(state.selectedComponentColor);
  }
  applySelectedNodesHighlight();
}

const NODE_PICK_COLOR = '#2f6fed';
const NODE_PICK_BORDER = '#1d4fc4';
const NODE_PICK_GLOW = 'drop-shadow(0 0 5px #2f6fed)';

export function applySelectedNodesHighlight() {
  const container = dom.output || document;
  const selected = state.selectedNodes || [];

  container.querySelectorAll('[data-node-ref]').forEach(el => {
    const nodeRef = el.getAttribute('data-node-ref');
    const isPicked = selected.includes(nodeRef);
    el.dataset.pickedNode = isPicked ? 'true' : 'false';

    if (isPicked) {
      if (el.dataset.hasStroke === 'true') {
        el.style.stroke = NODE_PICK_BORDER;
        el.style.strokeWidth = '2.5';
      }
      if (el.dataset.hasFill === 'true') {
        el.style.fill = NODE_PICK_COLOR;
        el.style.fillOpacity = '1.0';
      }
      el.style.filter = NODE_PICK_GLOW;
    } else if (el.dataset.selected !== 'true') {
      const revertColor = el.dataset.displayColor ? `#${el.dataset.displayColor}` : '';
      if (el.dataset.hasStroke === 'true') el.style.stroke = revertColor;
      if (el.dataset.hasFill === 'true') {
        el.style.fill = revertColor;
        el.style.fillOpacity = revertColor ? '1.0' : '';
      }
      el.style.strokeWidth = '';
      el.style.filter = '';
    }
  });
}

export function applySelectionHighlight(selectedColorKey) {
  const container = dom.output || document;

  // Clear previous selection highlights from paths and reset to displayColor
  container.querySelectorAll('[data-color-key]').forEach(el => {
    el.dataset.selected = 'false';
    if (el.dataset.pickedNode === 'true') return;
    const revertColor = el.dataset.displayColor ? `#${el.dataset.displayColor}` : '';
    el.style.stroke = el.dataset.hasStroke === 'true' ? revertColor : '';
    el.style.fill = el.dataset.hasFill === 'true' ? revertColor : '';
    el.style.fillOpacity = el.dataset.hasFill === 'true' && revertColor ? '1.0' : '';
    el.style.strokeWidth = '';
    el.style.filter = '';
  });

  if (!selectedColorKey) return;

  const colorMap = state.colorMap || {};
  const targetNorm = normalizeColor(selectedColorKey);

  // Collect matching identifiers across original keys, edited meta colors, display colors, and node refs
  const matchingIdentifiers = new Set();
  if (targetNorm) matchingIdentifiers.add(targetNorm);

  Object.entries(colorMap).forEach(([key, meta]) => {
    const normKey = normalizeColor(key);
    const normMetaColor = meta?.color ? normalizeColor(meta.color) : null;
    const normDisplayColor = meta?.displayColor ? normalizeColor(meta.displayColor) : null;

    const isMatch =
      normKey === targetNorm ||
      normMetaColor === targetNorm ||
      normDisplayColor === targetNorm ||
      key === selectedColorKey ||
      meta?.nodeRef === selectedColorKey;

    if (isMatch) {
      if (normKey) matchingIdentifiers.add(normKey);
      if (normMetaColor) matchingIdentifiers.add(normMetaColor);
      if (normDisplayColor) matchingIdentifiers.add(normDisplayColor);
      if (meta?.nodeRef) matchingIdentifiers.add(String(meta.nodeRef));
    }
  });

  // Apply golden selection highlight directly to target SVG elements
  container.querySelectorAll('[data-color-key]').forEach(el => {
    if (el.dataset.pickedNode === 'true') return;
    const elColorKey = el.getAttribute('data-color-key');
    const elNodeRef = el.getAttribute('data-node-ref');

    if (
      matchingIdentifiers.has(elColorKey) ||
      (elNodeRef && matchingIdentifiers.has(elNodeRef)) ||
      elColorKey === targetNorm
    ) {
      el.dataset.selected = 'true';

      if (el.dataset.hasStroke === 'true') {
        el.style.stroke = GOLDEN_BORDER;
        el.style.strokeWidth = '2.5';
      }
      if (el.dataset.hasFill === 'true') {
        el.style.fill = GOLDEN_COLOR;
        el.style.fillOpacity = '1.0';
      }
      el.style.filter = GOLDEN_GLOW;
    }
  });
}

export function highlightCodeLine(lineNumber) {
  if (lineNumber === null || lineNumber === undefined || !dom.latexInput) return;
  const text = dom.latexInput.value;
  const lines = text.split('\n');
  if (lineNumber < 0 || lineNumber >= lines.length) return;

  let start = 0;
  for (let i = 0; i < lineNumber; i++) {
    start += lines[i].length + 1;
  }
  const end = start + lines[lineNumber].length;

  dom.latexInput.setSelectionRange(start, end);

  const computed = window.getComputedStyle(dom.latexInput);
  const lineHeight = parseFloat(computed.lineHeight) || 16;
  dom.latexInput.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
}

export function announceSelection(selectedColorKey) {
  if (!selectedColorKey) {
    applySelectionHighlight(null);
    return;
  }

  const colorMap = state.colorMap || {};
  const targetNorm = normalizeColor(selectedColorKey);

  const meta = Object.values(colorMap).find(m => {
    if (!m) return false;
    if (m.color && normalizeColor(m.color) === targetNorm) return true;
    if (m.displayColor && normalizeColor(m.displayColor) === targetNorm) return true;
    if (m.nodeRef && (m.nodeRef === selectedColorKey || String(m.nodeRef) === targetNorm)) return true;
    return false;
  }) || (colorMap[selectedColorKey] ? colorMap[selectedColorKey] : null);

  if (meta && meta.lineNumber !== undefined) {
    highlightCodeLine(meta.lineNumber);
  }

  applySelectionHighlight(selectedColorKey);
}