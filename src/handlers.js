import { state } from './state.js';
import { dom } from './main.js';
import { fetchRenderedMetadata, getComponentsConfig, populateComponentDropdown } from './tikz.js';
import { normalizeColor, announceSelection, clearTooltips, applySelectedNodesHighlight } from './interactive.js';
import { processLatexCode, insertCircuitLine, updateLineInTex, deleteLineInTex, COLOR_PREFIX_RE, parseEndpointOption } from './latex.js';

let activeNodeMode = 'simple';
let activeNodeType = 'Between';
let preferredPathMode = 'new';

function getSelectedNodes() {
  return state.selectedNodes || [];
}

function hasTwoSelectedNodes() {
  return getSelectedNodes().length === 2;
}

// ---------------------------------------------------------------------
// Node selection for Add flows (selection happens on the canvas, before
// the Add Component / Add Node panel is opened)
// ---------------------------------------------------------------------

export function toggleSelectedNode(nodeRef) {
  if (!nodeRef) return;
  const list = state.selectedNodes || (state.selectedNodes = []);
  const idx = list.indexOf(nodeRef);
  if (idx !== -1) {
    list.splice(idx, 1);
  } else {
    list.push(nodeRef);
    if (list.length > 2) list.shift();
  }
  refreshSelectedNodesUI();
}

export function clearSelectedNodes() {
  state.selectedNodes = [];
  refreshSelectedNodesUI();
}

function refreshSelectedNodesUI() {
  applySelectedNodesHighlight();
  if (getSelectedNodes().length > 0) {
    showAddChoicePanels();
  } else {
    hideAddPanels();
  }
}

function syncNodeFieldsFromSelection() {
  const [first = '', second = ''] = getSelectedNodes();
  if (dom.modalCurrentNode) dom.modalCurrentNode.value = first;
  if (dom.addNodeCurrentNode) dom.addNodeCurrentNode.value = first;
  if (dom.addNodeRef2Input) dom.addNodeRef2Input.value = second;
  const targetNodeEl = document.getElementById('modalTargetNodeInput');
  if (targetNodeEl) targetNodeEl.value = second;
}

function updateMainChoiceAvailability() {
  const oneNodeButtons = [
    'modalChoiceAddNodeComponentBtn',
    'modalChoiceAddPathNewNodeBtn',
    'modalChoiceAddTextComponentBtn',
    'modalChoiceAddSimpleNodeBtn'
  ];
  const twoNodeButtons = [
    'modalChoiceAddPathBetweenNodesBtn',
    'modalChoiceAddNodeBetweenBtn',
    'modalChoiceAddNodeCornerBtn'
  ];
  const count = getSelectedNodes().length;
  oneNodeButtons.forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = count !== 1;
    if (count === 1) delete button.dataset.tooltip;
    else button.dataset.tooltip = 'Active on one node selection';
  });
  twoNodeButtons.forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    button.disabled = count !== 2;
    if (count === 2) delete button.dataset.tooltip;
    else button.dataset.tooltip = 'Active on two nodes selection';
  });
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getNextComponentName(type) {
  let maxNum = 0;
  const components = state.parsedData?.components || [];
  components.forEach(c => {
    if (c.type === type && c.name) {
      const match = c.name.match(/\d+$/);
      if (match) {
        const num = parseInt(match[0], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  });
  return `${type}${maxNum + 1}`;
}

export function isStandaloneNode(nodeRef) {
  if (!nodeRef || typeof nodeRef !== 'string' || nodeRef === 'N0') return false;
  if (!nodeRef.startsWith('N') || nodeRef.includes('.')) return false;

  const components = state.parsedData?.components || [];
  const isUsed = components.some(comp => {
    return comp.start === nodeRef || comp.end === nodeRef || comp.node === nodeRef;
  });

  return !isUsed;
}

export function deleteNode(nodeRef) {
  if (!nodeRef || typeof nodeRef !== 'string' || nodeRef === 'N0') return;
  
  const meta = Object.values(state.colorMap || {}).find(m => m.nodeRef === nodeRef || m.node?.name === nodeRef);
  if (meta && meta.lineNumber !== undefined) {
    deleteLineInTex(meta.lineNumber);
  } else {
    const lines = dom.latexInput.value.split('\n');
    const idx = lines.findIndex(l => l.includes(`coordinate (${nodeRef})`) || l.includes(`(${nodeRef}) circle`));
    if (idx !== -1) deleteLineInTex(idx);
  }

  closeDeviceModal();
  processLatexCode();
}

export function deleteComponent(colorKey) {
  if (!colorKey) return;
  const targetNorm = normalizeColor(colorKey);
  const meta = Object.values(state.colorMap || {}).find(m => normalizeColor(m.color) === targetNorm);
  
  if (meta && meta.lineNumber !== undefined) {
    deleteLineInTex(meta.lineNumber);
  }

  if (normalizeColor(state.selectedComponentColor) === targetNorm) {
    selectComponent(null);
  }

  processLatexCode();
}

// N0, component terminal pins, and path-generated end nodes have no
// standalone editable line, so they can only be picked, never edited.
function isEditableNode(nodeRef) {
  if (!nodeRef || typeof nodeRef !== 'string') return false;
  if (nodeRef === 'N0' || nodeRef.includes('.')) return false;

  // Nodes with an explicit coordinate definition in parsedData are editable
  const hasStandaloneDefinition = state.parsedData?.nodes?.some(
    node => node.name === nodeRef && node.lineIndex !== undefined && node.lineIndex !== null
  );
  if (hasStandaloneDefinition) return true;

  // Check if node is generated inline by a path component without its own standalone definition
  const isPathGeneratedNode = state.parsedData?.components?.some(component =>
    component.style === 'path' && component.end === nodeRef
  );

  return !isPathGeneratedNode;
}

export function isActionableElement(colorKey) {
  if (!colorKey) return false;
  const targetNorm = normalizeColor(colorKey);
  const meta = Object.values(state.colorMap || {}).find(m => 
    normalizeColor(m.color) === targetNorm || 
    (m.nodeRef && (m.nodeRef === colorKey || String(m.nodeRef) === targetNorm))
  );
  if (!meta) return false;

  let lineIndex = meta.lineNumber;
  let targetNodeRef = meta.nodeRef || meta.node?.name;

  if (targetNodeRef && !isEditableNode(targetNodeRef)) return false;

  if (targetNodeRef) {
    if (lineIndex === undefined || lineIndex === null) {
      const nodeDef = state.parsedData?.nodes?.find(n => n.name === targetNodeRef);
      if (nodeDef) lineIndex = nodeDef.lineIndex;
    }
    if (lineIndex === undefined || lineIndex === null) {
      const generatedBy = state.parsedData?.components?.find(component =>
        component.style === 'path' && component.end === targetNodeRef
      );
      if (generatedBy) lineIndex = generatedBy.lineIndex;
    }
  }

  if (lineIndex === undefined || lineIndex === null) return Boolean(meta.nodeRef);

  const lines = dom.latexInput.value.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return false;
  const rawLineText = lines[lineIndex];
  const parsed = parseTeXLine(rawLineText);
  return Boolean(parsed);
}

export function selectComponent(colorKey) {
  if (!colorKey || !isActionableElement(colorKey)) {
    state.selectedComponentColor = null;
    clearTooltips();
  } else {
    closeDeviceModal();
    const targetNorm = normalizeColor(colorKey);
    const exists = Object.keys(state.colorMap || {}).some(k => normalizeColor(k) === targetNorm);
    state.selectedComponentColor = exists ? colorKey : null;
    if (state.selectedComponentColor) clearSelectedNodes();
  }
  updateEditPanel(true);
  announceSelection(state.selectedComponentColor);
}

function getSelectedColorMeta() {
  const colorKey = state.selectedComponentColor;
  if (!colorKey) return null;
  const targetNorm = normalizeColor(colorKey);
  return Object.values(state.colorMap || {}).find(m => normalizeColor(m.color) === targetNorm) || null;
}

const EDIT_COLORS = [
  ['000000', 'Black (#000000)'],
  ['FF0000', 'Red (#FF0000)'],
  ['FFA500', 'Orange (#FFA500)'],
  ['FFFF00', 'Yellow (#FFFF00)'],
  ['008000', 'Green (#008000)'],
  ['0000FF', 'Blue (#0000FF)'],
  ['800080', 'Purple (#800080)']
];

function getEditColorOptions(selectedColor) {
  const normalizedColor = normalizeColor(selectedColor) || '000000';
  const colors = EDIT_COLORS.some(([value]) => value.toLowerCase() === normalizedColor)
    ? EDIT_COLORS
    : [[normalizedColor, `Current (#${normalizedColor})`], ...EDIT_COLORS];

  return colors.map(([value, label]) =>
    `<option value="${value}" ${value.toLowerCase() === normalizedColor ? 'selected' : ''}>${label}</option>`
  ).join('');
}

function applyEditColor(line, color) {
  const normalizedColor = normalizeColor(color) || '000000';
  return `\\definecolor{coloring}{HTML}{${normalizedColor}} ${line}`;
}

// ---------------------------------------------------------------------
// TeX Line Parser & Builder Engine
// ---------------------------------------------------------------------

function parseScopeTransforms(lineText) {
  const scopeMatch = lineText.match(/\\begin\{scope\}\[([^\]]*)\]/i);
  if (!scopeMatch) return { xscale: 1.0, yscale: 1.0, rotate: 0 };
  const opts = scopeMatch[1];
  const xs = opts.match(/xscale\s*=\s*(-?[0-9.]+)/i);
  const ys = opts.match(/yscale\s*=\s*(-?[0-9.]+)/i);
  const rot = opts.match(/rotate\s*=\s*(-?[0-9.]+)/i);

  return {
    xscale: xs ? parseFloat(xs[1]) : 1.0,
    yscale: ys ? parseFloat(ys[1]) : 1.0,
    rotate: rot ? parseFloat(rot[1]) : 0
  };
}

function buildScopeWrapper(innerDraw, { xscale = 1, yscale = 1, rotate = 0 }) {
  return `\\begin{scope}[transform shape, xscale=${xscale}, yscale=${yscale}, rotate=${rotate}] ${innerDraw} \\end{scope}`;
}

function parseLabelOption(opts) {
  const directLabelMatch = opts.match(/(?:^|,)\s*l(\^|_)?\s*=\s*(\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge))\{([^{}]*)\}/i);
  const labelMatch = opts.match(/(?:^|,)\s*l(\^|_)?\s*=\s*([^,]*)/i);
  if (labelMatch) {
    return {
      label: directLabelMatch ? directLabelMatch[3].trim() : labelMatch[2].trim(),
      labelPosition: labelMatch[1] === '^' ? 'above' : labelMatch[1] === '_' ? 'below' : 'auto',
      labelSize: directLabelMatch ? directLabelMatch[2] : '\\normalsize'
    };
  }

  const valueMatch = opts.match(/^[^,=]+\s*=\s*([^,]*)/);
  return {
    label: valueMatch ? valueMatch[1].trim() : '',
    labelPosition: 'auto',
    labelSize: '\\normalsize'
  };
}

function parseTeXLine(lineText) {
  if (!lineText || !lineText.trim()) return null;
  const transforms = parseScopeTransforms(lineText);
  let clean = lineText.split('%')[0].trim();
  clean = clean.replace(COLOR_PREFIX_RE, '').trim();
  clean = clean.replace(/^\\nextGroup\s*/i, '').trim();
  clean = clean.replace(/\\begin\{scope\}\[[^\]]*\]/i, '').replace(/\\end\{scope\}/i, '').trim();
  clean = clean.replace(/^\\draw\s*(?:\[[^\]]*\])?\s*/i, '').trim();

  // 1. Path Components (\draw ... to[...] ...)
  if (/\bto\s*\[/i.test(clean)) {
    const match = clean.match(/^(.+?)\s+to\s*\[([^\]]*)\]\s*(.+);/i);
    if (match) {
      const startNode = match[1].trim().replace(/^\(|\)$/g, '');
      const opts = match[2].trim();
      let targetStr = match[3].trim();

      const endpoints = parseEndpointOption(opts);
      let cleanOpts = opts.replace(/(?:^|,)\s*(\*-\*|o-o|\*-o|o-\*|\*-|-\*|o-|-o)\s*(?:,|$)/g, ',').trim();
      cleanOpts = cleanOpts.replace(/^,|,$/g, '').trim();
      const symbol = cleanOpts.split(/[=,]/)[0].trim();
      const { label, labelPosition, labelSize } = parseLabelOption(opts);

      let coordName = '';
      const coordMatch = targetStr.match(/coordinate\s*\(([^)]+)\)/i);
      if (coordMatch) {
        coordName = coordMatch[1].trim();
        targetStr = targetStr.replace(/coordinate\s*\([^)]+\)/i, '').trim();
      }

      let baseNode = startNode;
      let xlen = 2.0, ylen = 0.0;
      let hasCalc = false;

      const calcMatch = targetStr.match(/\$\s*\(([^)]+)\)\s*\+\s*\(([^)]+)\)\s*\$/);
      if (calcMatch) {
        hasCalc = true;
        baseNode = calcMatch[1].trim();
        const parts = calcMatch[2].split(',').map(s => parseFloat(s.trim()));
        xlen = !isNaN(parts[0]) ? parts[0] : 2.0;
        ylen = !isNaN(parts[1]) ? parts[1] : 0.0;
      } else {
        baseNode = targetStr.replace(/^\(|\)$/g, '').trim();
      }

      const configs = getComponentsConfig();
      const typeKey = Object.keys(configs).find(k => configs[k].style === 'path' && configs[k].symbol === symbol) || 'wire';

      return {
        kind: 'path',
        startNode,
        symbol,
        endpoints,
        typeKey,
        label,
        labelPosition,
        labelSize,
        baseNode,
        coordName,
        hasCalc,
        xlen,
        ylen,
        ...transforms
      };
    }
  }

  // 2. Node Components (\draw ... node[...] ...)
  if (/\bnode\s*\[/i.test(clean)) {
    const match = clean.match(/^(.+?)\s+node\s*\[([^\]]+)\]\s*\(([^)]+)\)\s*\{\}\s*;/i);
    if (match) {
      const rawHost = match[1].trim();
      const opts = match[2].trim();
      const compName = match[3].trim();

      let hostNode = rawHost;
      let xshift = 0.0, yshift = 0.0;

      const calcMatch = rawHost.match(/\$\s*\(([^)]+)\)\s*\+\s*\(([^)]+)\)\s*\$/);
      if (calcMatch) {
        hostNode = calcMatch[1].trim();
        const parts = calcMatch[2].split(',').map(s => parseFloat(s.trim()));
        xshift = !isNaN(parts[0]) ? parts[0] : 0.0;
        yshift = !isNaN(parts[1]) ? parts[1] : 0.0;
      } else {
        hostNode = rawHost.replace(/^\(|\)$/g, '').trim();
      }

      const anchorMatch = opts.match(/anchor=([^,\s\]]+)/i);
      const anchor = anchorMatch ? anchorMatch[1].trim() : '';
      const directLabelMatch = opts.match(/(?:^|,)\s*label\s*=\s*(above|below|left|right|center):\s*(\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge))\{([^{}]*)\}/i);
      const labelMatch = opts.match(/(?:^|,)\s*label\s*=\s*(?:(above|below|left|right|center):)?([^,]*)/i);

      const configs = getComponentsConfig();
      const typeKey = /inner\s+sep\s*=\s*0pt/i.test(opts) ? 'text' : Object.keys(configs).find(k => {
        if (configs[k].style !== 'node') return false;
        const sym = configs[k].symbol.trim();
        return new RegExp('(?:^|,|\\s)' + escapeRegExp(sym) + '(?:$|,|\\s)', 'i').test(opts);
      }) || 'ground';

      return {
        kind: 'nodeComp',
        hostNode,
        compName,
        anchor,
        typeKey,
        label: directLabelMatch ? directLabelMatch[3].trim() : labelMatch ? labelMatch[2].trim() : '',
        labelPosition: directLabelMatch ? directLabelMatch[1].toLowerCase() : labelMatch?.[1]?.toLowerCase() || 'above',
        labelSize: directLabelMatch ? directLabelMatch[2] : '\\normalsize',
        xshift,
        yshift,
        ...transforms
      };
    }
  }

  // 3. Node Coordinates (\draw ... coordinate (...) ...)
  const drawCoordMatch = clean.match(/^\((.+)\)\s+coordinate\s*\(([^)]+)\);/i);
  const legacyCoordMatch = clean.match(/^\\?coordinate(?:\s*\[[^\]]*\])?\s+\(?([a-zA-Z0-9_\.]+)\)?\s+at\s*(.+);/i);

  let nodeName = null;
  let expr = null;

  if (drawCoordMatch) {
    expr = drawCoordMatch[1].trim();
    nodeName = drawCoordMatch[2].trim();
  } else if (legacyCoordMatch) {
    nodeName = legacyCoordMatch[1].trim();
    expr = legacyCoordMatch[2].trim();
  }

  if (nodeName && expr) {
    const betweenMatch = expr.match(/\$\s*\(?\s*([a-zA-Z0-9_\.\+-]+)\)?\s*!\s*([^!]+)\s*!\s*\(?\s*([a-zA-Z0-9_\.\+-]+)\)?\s*\$/);
    const calcMatch = expr.match(/\$\s*\(([^)]+)\)\s*\+\s*\(([^)]+)\)\s*\$/);
    const cornerMatch = expr.match(/\(?\s*([a-zA-Z0-9_\.\+-]+)\s*(\-\||\|-)\s*([a-zA-Z0-9_\.\+-]+)\s*\)?/);

    let mode = 'absolute';
    let ref1 = '', ref2 = '', xlen = 2.0, ylen = 0.0, location = '0.5', cornerType = '-|', absX = 0, absY = 0;

    if (betweenMatch) {
      mode = 'between';
      ref1 = betweenMatch[1].trim();
      location = betweenMatch[2].trim();
      ref2 = betweenMatch[3].trim();
    } else if (calcMatch) {
      mode = '1node';
      ref1 = calcMatch[1].trim();
      const parts = calcMatch[2].split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        xlen = parts[0];
        ylen = parts[1];
      }
    } else if (cornerMatch) {
      mode = 'corner';
      ref1 = cornerMatch[1].trim();
      cornerType = cornerMatch[2].trim();
      ref2 = cornerMatch[3].trim();
    } else {
      mode = 'absolute';
      const cleanExpr = expr.replace(/^\(|\)$/g, '');
      const parts = cleanExpr.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        absX = parts[0];
        absY = parts[1];
      }
    }

    return {
      kind: 'coord',
      nodeName,
      mode,
      ref1,
      ref2,
      xlen,
      ylen,
      location,
      cornerType,
      absX,
      absY,
      ...transforms
    };
  }

  return null;
}

function buildPathLine(p) {
  const configs = getComponentsConfig();
  const cfg = configs[p.typeKey] || { symbol: 'short' };
  const symbol = cfg.symbol || 'short';
  const endpointArg = p.endpoints && p.endpoints !== '-' ? `,${p.endpoints}` : '';
  const labelArg = p.labelPosition === 'above'
    ? `,l^=${p.labelSize || '\\normalsize'}{${p.label || ''}}`
    : p.labelPosition === 'below'
      ? `,l_=${p.labelSize || '\\normalsize'}{${p.label || ''}}`
      : `,l=${p.labelSize || '\\normalsize'}{${p.label || ''}}`;

  const base = p.baseNode || p.startNode;
  let targetStr = '';

  if (p.hasCalc || p.coordName) {
    targetStr = `($(${base})+(${p.xlen},${p.ylen})$)`;
    if (p.coordName) {
      targetStr += ` coordinate (${p.coordName})`;
    }
  } else {
    targetStr = `(${base})`;
  }

  const drawStr = `\\draw [coloring] (${p.startNode}) to[${symbol}${endpointArg}${labelArg}] ${targetStr};`;
  return buildScopeWrapper(drawStr, p);
}

function buildNodeCompLine(p) {
  const configs = getComponentsConfig();
  const cfg = configs[p.typeKey] || (p.typeKey === 'text' ? { isText: true } : { symbol: 'ground' });
  const symbol = cfg.symbol || 'ground';
  const extraArgs = cfg.args ? `, ${cfg.args}` : '';
  const anchorArg = p.anchor ? `, anchor=${p.anchor}` : '';
  const labelArg = `, label=${p.labelPosition || 'above'}:${p.labelSize || '\\normalsize'}{${p.label || ''}}`;
  const nodeOptions = cfg.isText
    ? `inner sep=0pt, color=coloring${labelArg}`
    : `${symbol}${extraArgs}, color=coloring${anchorArg}${labelArg}`;

  const hostExpr = (p.xshift || p.yshift)
    ? `($(${p.hostNode})+(${p.xshift},${p.yshift})$)`
    : `(${p.hostNode})`;

  const drawStr = `\\draw [coloring] ${hostExpr} node[${nodeOptions}] (${p.compName}) {};`;
  return buildScopeWrapper(drawStr, p);
}

function buildCoordLine(p) {
  let drawStr = '';
  if (p.mode === '1node') {
    drawStr = `\\draw [coloring] coordinate (${p.nodeName}) at ($(${p.ref1})+(${p.xlen},${p.ylen})$);`;
  } else if (p.mode === 'between') {
    drawStr = `\\draw [coloring] coordinate (${p.nodeName}) at ($(${p.ref1})!${p.location}!(${p.ref2})$);`;
  } else if (p.mode === 'corner') {
    drawStr = `\\draw [coloring] coordinate (${p.nodeName}) at (${p.ref1} ${p.cornerType} ${p.ref2});`;
  } else {
    drawStr = `\\draw [coloring] (${p.absX},${p.absY}) coordinate (${p.nodeName});`;
  }
  return buildScopeWrapper(drawStr, p);
}

// ---------------------------------------------------------------------
// TeX source line highlight
// Shows a translucent band over whichever line in the code textarea
// corresponds to the currently selected component/node. Implemented as
// a pointer-events:none overlay layered on top of the textarea so it
// works regardless of theme/colors and never intercepts clicks or typing.
// ---------------------------------------------------------------------

let texHighlightWrapper = null;
let texHighlightMarker = null;
let texHighlightLine = null;
let texHighlightListenersBound = false;

function ensureTexHighlightLayer() {
  if (texHighlightWrapper) return true;
  const textarea = dom.latexInput;
  if (!textarea || !textarea.parentNode) return false;

  const parent = textarea.parentNode;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.className = 'tex-line-highlight-layer';
  wrapper.style.position = 'absolute';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.overflow = 'hidden';
  wrapper.style.zIndex = '5';

  const marker = document.createElement('div');
  marker.style.position = 'absolute';
  marker.style.left = '0';
  marker.style.right = '0';
  marker.style.background = 'rgba(255, 202, 40, 0.28)';
  marker.style.display = 'none';
  wrapper.appendChild(marker);

  parent.appendChild(wrapper);

  texHighlightWrapper = wrapper;
  texHighlightMarker = marker;

  if (!texHighlightListenersBound) {
    textarea.addEventListener('scroll', positionTexHighlight);
    window.addEventListener('resize', positionTexHighlight);
    texHighlightListenersBound = true;
  }

  return true;
}

function positionTexHighlight() {
  if (!texHighlightWrapper) return;
  const textarea = dom.latexInput;
  if (!textarea) return;

  texHighlightWrapper.style.top = `${textarea.offsetTop}px`;
  texHighlightWrapper.style.left = `${textarea.offsetLeft}px`;
  texHighlightWrapper.style.width = `${textarea.offsetWidth}px`;
  texHighlightWrapper.style.height = `${textarea.offsetHeight}px`;

  if (texHighlightLine === null) {
    texHighlightMarker.style.display = 'none';
    return;
  }

  const style = getComputedStyle(textarea);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  let lineHeight = parseFloat(style.lineHeight);
  if (isNaN(lineHeight)) {
    lineHeight = (parseFloat(style.fontSize) || 14) * 1.2;
  }

  const top = paddingTop + texHighlightLine * lineHeight - textarea.scrollTop;
  texHighlightMarker.style.top = `${top}px`;
  texHighlightMarker.style.height = `${lineHeight}px`;
  texHighlightMarker.style.display = 'block';
}

// Highlights the given 0-based line index in the tex textarea, or clears
// the highlight when passed null/undefined.
export function highlightTexLine(lineIndex) {
  texHighlightLine = (typeof lineIndex === 'number' && !isNaN(lineIndex)) ? lineIndex : null;
  if (!ensureTexHighlightLayer()) return;
  positionTexHighlight();
}

// ---------------------------------------------------------------------
// Unified Edit Panel UI
// ---------------------------------------------------------------------

export function updateEditPanel(forceRefresh = false) {
  if (!dom.editPanel || !dom.editPanelBody) return;

  if (!state.selectedComponentColor) {
    dom.editPanel.style.display = 'none';
    dom.editPanelBody.innerHTML = '';
    highlightTexLine(null);
    return;
  }

  const colorMeta = getSelectedColorMeta();
  let lineIndex = colorMeta?.lineNumber;
  let targetNodeRef = colorMeta?.nodeRef;
  const isUneditableNode = targetNodeRef && !isEditableNode(targetNodeRef);

  if (isUneditableNode) {
    dom.editPanel.style.display = 'block';
    if (dom.editPanelTitle) dom.editPanelTitle.textContent = 'Uneditable node';
    dom.editPanelBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">Node Name</label>
        <input type="text" class="form-input" value="${targetNodeRef}" readonly />
      </div>
    `;
    highlightTexLine(null);
    return;
  }

  if (lineIndex === undefined || lineIndex === null) {
    if (targetNodeRef) {
      const nodeDef = state.parsedData?.nodes?.find(n => n.name === targetNodeRef);
      if (nodeDef) lineIndex = nodeDef.lineIndex;
    }
  }

  if (lineIndex === undefined || lineIndex === null) {
    dom.editPanel.style.display = 'block';
    if (dom.editPanelTitle) dom.editPanelTitle.textContent = 'Edit Node';
    dom.editPanelBody.innerHTML = '';
    highlightTexLine(null);
    return;
  }

  highlightTexLine(lineIndex);

  if (!forceRefresh && dom.editPanelBody.contains(document.activeElement)) {
    return;
  }

  const lines = dom.latexInput.value.split('\n');
  const rawLineText = lines[lineIndex];
  const parsed = parseTeXLine(rawLineText);

  if (!parsed) {
    dom.editPanel.style.display = 'block';
    if (dom.editPanelTitle) dom.editPanelTitle.textContent = 'Edit Node';
    dom.editPanelBody.innerHTML = '';
    return;
  }

  dom.editPanel.style.display = 'block';
  const configs = getComponentsConfig();

  // 1. Path Component Form
  if (parsed.kind === 'path') {
    const selectedColor = getSelectedColorMeta()?.displayColor || '000000';
    const isStartEnd = !parsed.hasCalc && !parsed.coordName;
    if (dom.editPanelTitle) dom.editPanelTitle.textContent = isStartEnd ? 'Edit Directional Component (Start-End)' : 'Edit Directional Component';
    dom.editPanelBody.innerHTML = `
    <div class="form-group">
    <label class="form-label">Label Text</label>
    <input type="text" id="editPathLabel" class="form-input" value="${parsed.label}" />
    </div>
    <div class="form-group">
    <label class="form-label">Label Position</label>
        <select id="editPathLabelPosition" class="form-select">
          <option value="above" ${parsed.labelPosition !== 'below' ? 'selected' : ''}>Above</option>
          <option value="below" ${parsed.labelPosition === 'below' ? 'selected' : ''}>Below</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Label Size</label>
        <select id="editPathLabelSize" class="form-select">
          <option value="\\tiny" ${parsed.labelSize === '\\tiny' ? 'selected' : ''}>Tiny</option>
          <option value="\\small" ${parsed.labelSize === '\\small' ? 'selected' : ''}>Small</option>
          <option value="\\normalsize" ${!parsed.labelSize || parsed.labelSize === '\\normalsize' ? 'selected' : ''}>Normal</option>
          <option value="\\large" ${parsed.labelSize === '\\large' ? 'selected' : ''}>Large</option>
          <option value="\\huge" ${parsed.labelSize === '\\huge' ? 'selected' : ''}>Huge</option>
          <option value="\\Huge" ${parsed.labelSize === '\\Huge' ? 'selected' : ''}>Extra Huge</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Endpoint Style</label>
        <select id="editPathEndpoints" class="form-select">
          <option value="" ${!parsed.endpoints || parsed.endpoints === '-' ? 'selected' : ''}>Plain/Default (-)</option>
          <option value="*-*" ${parsed.endpoints === '*-*' ? 'selected' : ''}>Both Filled (*-*)</option>
          <option value="o-o" ${parsed.endpoints === 'o-o' ? 'selected' : ''}>Both Hollow (o-o)</option>
          <option value="*-" ${parsed.endpoints === '*-' ? 'selected' : ''}>Start Filled (*-)</option>
          <option value="-*" ${parsed.endpoints === '-*' ? 'selected' : ''}>End Filled (-*)</option>
          <option value="o-" ${parsed.endpoints === 'o-' ? 'selected' : ''}>Start Hollow (o-)</option>
          <option value="-o" ${parsed.endpoints === '-o' ? 'selected' : ''}>End Hollow (-o)</option>
          <option value="*-o" ${parsed.endpoints === '*-o' ? 'selected' : ''}>Filled-Hollow (*-o)</option>
          <option value="o-*" ${parsed.endpoints === 'o-*' ? 'selected' : ''}>Hollow-Filled (o-*)</option>
        </select>
      </div>
      ${!isStartEnd ? `
      <div class="form-group">
        <label class="form-label">X Direction</label>
        <input type="number" step="0.1" id="editPathXLen" class="form-input" value="${Number(parsed.xlen).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Y Direction</label>
        <input type="number" step="0.1" id="editPathYLen" class="form-input" value="${Number(parsed.ylen).toFixed(1)}" />
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">X Scale</label>
        <input type="number" step="0.1" id="editCompXScale" class="form-input" value="${Number(parsed.xscale).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Y Scale</label>
        <input type="number" step="0.1" id="editCompYScale" class="form-input" value="${Number(parsed.yscale).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Rotate (deg)</label>
        <input type="number" step="15" id="editCompRotate" class="form-input" value="${Number(parsed.rotate).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <select id="editCompColor" class="form-select">
          ${getEditColorOptions(selectedColor)}
        </select>
      </div>
      <button id="editCompDeleteBtn" class="form-btn btn-danger">Delete Component</button>
    `;

    const applyPathChanges = () => {
      const color = document.getElementById('editCompColor')?.value || selectedColor;
      const endpoints = document.getElementById('editPathEndpoints')?.value || '';
      const label = document.getElementById('editPathLabel')?.value.trim() ?? parsed.label;
      const labelPosition = document.getElementById('editPathLabelPosition')?.value || parsed.labelPosition;
      const labelSize = document.getElementById('editPathLabelSize')?.value || parsed.labelSize;
      const editXEl = document.getElementById('editPathXLen');
      const editYEl = document.getElementById('editPathYLen');
      const rawX = editXEl ? parseFloat(editXEl.value) : parsed.xlen;
      const xlen = !isNaN(rawX) ? rawX : parsed.xlen;
      const rawY = editYEl ? parseFloat(editYEl.value) : parsed.ylen;
      const ylen = !isNaN(rawY) ? rawY : parsed.ylen;
      const xscale = parseFloat(document.getElementById('editCompXScale')?.value || parsed.xscale);
      const yscale = parseFloat(document.getElementById('editCompYScale')?.value || parsed.yscale);
      const rotate = parseFloat(document.getElementById('editCompRotate')?.value || parsed.rotate);

      const newLine = applyEditColor(buildPathLine({
        ...parsed,
        endpoints,
        label,
        labelPosition,
        labelSize,
        xlen,
        ylen,
        xscale,
        yscale,
        rotate
      }), color);

      updateLineInTex(lineIndex, newLine);
      processLatexCode({ skipRender: false, preserveSelection: true });
    };

    ['editCompColor', 'editPathEndpoints', 'editPathLabel', 'editPathLabelPosition', 'editPathLabelSize', 'editPathXLen', 'editPathYLen', 'editCompXScale', 'editCompYScale', 'editCompRotate']
      .forEach(id => document.getElementById(id)?.addEventListener('input', applyPathChanges));

    document.getElementById('editCompDeleteBtn')?.addEventListener('click', () => deleteComponent(state.selectedComponentColor));
  }

  // 2. Node Component Form
  else if (parsed.kind === 'nodeComp') {
    const selectedColor = getSelectedColorMeta()?.displayColor || '000000';
    const nodeConfig = configs[parsed.typeKey] || (parsed.typeKey === 'text' ? { isText: true } : {});
    const anchorOptions = !nodeConfig.isText && nodeConfig.terminals?.length
      ? `
      <div class="form-group">
        <label class="form-label">Anchor Pin</label>
        <select id="editNodeCompAnchor" class="form-select">
          ${nodeConfig.terminals.map(terminal => `<option value="${terminal.name}" ${parsed.anchor === terminal.name ? 'selected' : ''}>${terminal.displayName || terminal.name}</option>`).join('')}
        </select>
      </div>`
      : '';
    if (dom.editPanelTitle) dom.editPanelTitle.textContent = nodeConfig.isText ? 'Edit Text Component' : 'Edit Block Component';
    dom.editPanelBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">${nodeConfig.isText ? 'Text' : 'Label Text'}</label>
        <input type="text" id="editNodeCompLabel" class="form-input" value="${parsed.label}" ${nodeConfig.isText ? 'required' : ''} />
      </div>
      <div class="form-group">
        <label class="form-label">Label Position</label>
        <select id="editNodeCompLabelPosition" class="form-select">
          <option value="above" ${parsed.labelPosition === 'above' ? 'selected' : ''}>Above</option>
          <option value="below" ${parsed.labelPosition === 'below' ? 'selected' : ''}>Below</option>
          <option value="left" ${parsed.labelPosition === 'left' ? 'selected' : ''}>Left</option>
          <option value="right" ${parsed.labelPosition === 'right' ? 'selected' : ''}>Right</option>
          <option value="center" ${parsed.labelPosition === 'center' ? 'selected' : ''}>Center</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Label Size</label>
        <select id="editNodeCompLabelSize" class="form-select">
          <option value="\\tiny" ${parsed.labelSize === '\\tiny' ? 'selected' : ''}>Tiny</option>
          <option value="\\small" ${parsed.labelSize === '\\small' ? 'selected' : ''}>Small</option>
          <option value="\\normalsize" ${!parsed.labelSize || parsed.labelSize === '\\normalsize' ? 'selected' : ''}>Normal</option>
          <option value="\\large" ${parsed.labelSize === '\\large' ? 'selected' : ''}>Large</option>
          <option value="\\huge" ${parsed.labelSize === '\\huge' ? 'selected' : ''}>Huge</option>
          <option value="\\Huge" ${parsed.labelSize === '\\Huge' ? 'selected' : ''}>Extra Huge</option>
        </select>
      </div>
      ${anchorOptions}
      <div class="form-group">
        <label class="form-label">X Scale</label>
        <input type="number" step="0.1" id="editCompXScale" class="form-input" value="${Number(parsed.xscale).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Y Scale</label>
        <input type="number" step="0.1" id="editCompYScale" class="form-input" value="${Number(parsed.yscale).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Rotate (deg)</label>
        <input type="number" step="15" id="editCompRotate" class="form-input" value="${Number(parsed.rotate).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <select id="editCompColor" class="form-select">
          ${getEditColorOptions(selectedColor)}
        </select>
      </div>
      <button id="editCompDeleteBtn" class="form-btn btn-danger">Delete Component</button>
    `;

    const applyNodeCompChanges = () => {
      const color = document.getElementById('editCompColor')?.value || selectedColor;
      const labelInput = document.getElementById('editNodeCompLabel');
      const label = labelInput?.value.trim() ?? parsed.label;
      if (nodeConfig.isText && !label) {
        labelInput?.setCustomValidity('Text is required.');
        labelInput?.reportValidity();
        return;
      }
      labelInput?.setCustomValidity('');
      const labelPosition = document.getElementById('editNodeCompLabelPosition')?.value || parsed.labelPosition;
      const labelSize = document.getElementById('editNodeCompLabelSize')?.value || parsed.labelSize;
      const anchor = document.getElementById('editNodeCompAnchor')?.value || parsed.anchor;
      const xscale = parseFloat(document.getElementById('editCompXScale')?.value || parsed.xscale);
      const yscale = parseFloat(document.getElementById('editCompYScale')?.value || parsed.yscale);
      const rotate = parseFloat(document.getElementById('editCompRotate')?.value || parsed.rotate);

      const newLine = applyEditColor(buildNodeCompLine({
        ...parsed,
        label,
        labelPosition,
        labelSize,
        anchor,
        xscale,
        yscale,
        rotate
      }), color);

      updateLineInTex(lineIndex, newLine);
      processLatexCode({ skipRender: false, preserveSelection: true });
    };

    ['editCompColor', 'editNodeCompLabel', 'editNodeCompLabelPosition', 'editNodeCompLabelSize', 'editNodeCompAnchor', 'editCompXScale', 'editCompYScale', 'editCompRotate']
      .forEach(id => document.getElementById(id)?.addEventListener('input', applyNodeCompChanges));

    document.getElementById('editCompDeleteBtn')?.addEventListener('click', () => deleteComponent(state.selectedComponentColor));
  }

  // 3. Node Coordinate Form
  else if (parsed.kind === 'coord') {
    const isRootNode = parsed.nodeName === 'N0';
    const canDelete = isStandaloneNode(parsed.nodeName) && parsed.nodeName !== 'N0';
    if (dom.editPanelTitle) dom.editPanelTitle.textContent = parsed.mode === 'between' ? 'Edit Line Segment Node' : parsed.mode === 'corner' ? 'Edit Corner Intersection Node' : 'Edit Directional Node';

    dom.editPanelBody.innerHTML = `
      <div class="form-group">
        <label class="form-label">Node Name</label>
        <input type="text" id="editNodeName" class="form-input" value="${parsed.nodeName}" readonly />
      </div>

      ${!isRootNode && parsed.mode === '1node' ? `
      <div class="form-group">
        <label class="form-label">X Direction</label>
        <input type="number" step="0.1" id="editNodeXLen" class="form-input" value="${Number(parsed.xlen).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Y Direction</label>
        <input type="number" step="0.1" id="editNodeYLen" class="form-input" value="${Number(parsed.ylen).toFixed(1)}" />
      </div>` : ''}

      ${!isRootNode && parsed.mode === 'between' ? `
      <div class="form-group">
        <label class="form-label">Segment Location (0-1 or %)</label>
        <input type="text" id="editNodeLoc" class="form-input" value="${parsed.location}" />
      </div>` : ''}

      ${!isRootNode && parsed.mode === 'absolute' ? `
      <div class="form-group">
        <label class="form-label">X Coordinate</label>
        <input type="number" step="0.5" id="editNodeAbsX" class="form-input" value="${Number(parsed.absX).toFixed(1)}" />
      </div>
      <div class="form-group">
        <label class="form-label">Y Coordinate</label>
        <input type="number" step="0.5" id="editNodeAbsY" class="form-input" value="${Number(parsed.absY).toFixed(1)}" />
      </div>` : ''}

      ${!isRootNode && parsed.mode === 'corner' ? `
      <div class="form-group">
        <label class="form-label">Corner Alignment</label>
        <select id="editNodeCornerType" class="form-select">
          <option value="-|" ${parsed.cornerType === '-|' ? 'selected' : ''}>-|</option>
          <option value="|-" ${parsed.cornerType === '|-' ? 'selected' : ''}>|-</option>
        </select>
      </div>` : ''}

      ${!isRootNode ? `<div class="form-group">
        <label class="form-label">Rotate (deg)</label>
        <input type="number" step="15" id="editCompRotate" class="form-input" value="${Number(parsed.rotate).toFixed(1)}" />
      </div>` : ''}
      ${canDelete ? '<button id="editNodeDeleteBtn" class="form-btn btn-danger">Delete Node</button>' : ''}
    `;

    const applyNodeChanges = () => {
      if (isRootNode) return;
      const nodeName = document.getElementById('editNodeName')?.value.trim() || parsed.nodeName;
      const rawX = parseFloat(document.getElementById('editNodeXLen')?.value);
      const xlen = !isNaN(rawX) ? rawX : parsed.xlen;
      const rawY = parseFloat(document.getElementById('editNodeYLen')?.value);
      const ylen = !isNaN(rawY) ? rawY : parsed.ylen;
      const location = document.getElementById('editNodeLoc')?.value.trim() || parsed.location;
      const absX = parseFloat(document.getElementById('editNodeAbsX')?.value || parsed.absX);
      const absY = parseFloat(document.getElementById('editNodeAbsY')?.value || parsed.absY);
      const cornerType = document.getElementById('editNodeCornerType')?.value || parsed.cornerType;
      const rotate = parseFloat(document.getElementById('editCompRotate')?.value || parsed.rotate);

      const newLine = buildCoordLine({
        ...parsed,
        nodeName,
        xlen,
        ylen,
        location,
        absX,
        absY,
        cornerType,
        rotate
      });

      updateLineInTex(lineIndex, newLine);
      processLatexCode({ skipRender: false, preserveSelection: true });
    };

    (isRootNode ? [] : ['editNodeName', 'editNodeXLen', 'editNodeYLen', 'editNodeLoc', 'editNodeAbsX', 'editNodeAbsY', 'editNodeCornerType', 'editCompRotate'])
      .forEach(id => document.getElementById(id)?.addEventListener('input', applyNodeChanges));
    document.getElementById('editNodeCornerType')?.addEventListener('change', applyNodeChanges);

    if (canDelete) {
      document.getElementById('editNodeDeleteBtn')?.addEventListener('click', () => deleteNode(parsed.nodeName));
    }
  }
}

// ---------------------------------------------------------------------
// Add Device & Node Modal Listeners
// ---------------------------------------------------------------------

function showAddChoicePanels() {
  if (state.hideNodes) {
    state.hideNodes = false;
    if (dom.toggleNodesBtn) dom.toggleNodesBtn.textContent = 'Hide nodes';
    processLatexCode();
  }
  if (dom.editPanel) dom.editPanel.style.display = 'none';
  if (dom.modalDeviceSelect) dom.modalDeviceSelect.value = '';
  if (dom.modalCurrentNodeLabel) dom.modalCurrentNodeLabel.textContent = 'Placement Node';
  syncNodeFieldsFromSelection();
  if (dom.modalStep1) dom.modalStep1.style.display = 'none';
  if (dom.modalAddNodeStep) dom.modalAddNodeStep.style.display = 'none';
  if (dom.addPanelsContainer) dom.addPanelsContainer.style.display = 'flex';
  if (dom.addComponentsPanel) dom.addComponentsPanel.style.display = 'block';
  if (dom.addNodesPanel) dom.addNodesPanel.style.display = 'block';
  if (dom.addPanel) dom.addPanel.style.display = 'none';
  updateMainChoiceAvailability();
}

function hideAddPanels() {
  if (dom.addPanelsContainer) dom.addPanelsContainer.style.display = 'none';
  if (dom.addPanel) dom.addPanel.style.display = 'none';
}

export function closeDeviceModal() {
  if (getSelectedNodes().length > 0) {
    showAddChoicePanels();
  } else {
    hideAddPanels();
  }
}

export function initModalListeners() {
  if (dom.modalCloseBtn) dom.modalCloseBtn.addEventListener('click', closeDeviceModal);

  const openComponentStep = async (style, pathMode = 'new', excludedTypes = [], title = 'Add Component') => {
    preferredPathMode = pathMode;
    await populateComponentDropdown(style, excludedTypes);
    const selectorGroup = dom.modalDeviceSelect?.closest('.form-group');
    if (selectorGroup) selectorGroup.style.display = 'block';
    if (dom.modalTitle) dom.modalTitle.textContent = title;
    if (dom.modalAddBtn) dom.modalAddBtn.textContent = 'Add Component';
    if (dom.modalCurrentNodeLabel) dom.modalCurrentNodeLabel.textContent = style === 'path' ? 'Start Node' : 'Placement Node';
    syncNodeFieldsFromSelection();
    if (dom.modalPlacementNodeGroup) dom.modalPlacementNodeGroup.style.display = 'none';
    if (dom.addPanelsContainer) dom.addPanelsContainer.style.display = 'none';
    if (dom.addPanel) dom.addPanel.style.display = 'block';
    if (dom.modalStep1) dom.modalStep1.style.display = 'block';
    if (dom.modalDeviceSelect) {
      dom.modalDeviceSelect.value = '';
      updateComponentFields();
    }
  };

  if (dom.modalChoiceAddNodeComponentBtn) {
    dom.modalChoiceAddNodeComponentBtn.addEventListener('click', () => {
      openComponentStep('node', 'new', ['text'], 'Add Block Component');
    });
  }

  if (dom.modalChoiceAddTextComponentBtn) {
    dom.modalChoiceAddTextComponentBtn.addEventListener('click', async () => {
      await openComponentStep('node', 'new', [], 'Add Text Component');
      const textOption = document.createElement('option');
      textOption.value = 'text';
      textOption.textContent = 'Text';
      dom.modalDeviceSelect.appendChild(textOption);
      dom.modalDeviceSelect.value = 'text';
      const selectorGroup = dom.modalDeviceSelect.closest('.form-group');
      if (selectorGroup) selectorGroup.style.display = 'none';
      updateComponentFields();
    });
  }

  if (dom.modalChoiceAddPathNewNodeBtn) {
    dom.modalChoiceAddPathNewNodeBtn.addEventListener('click', () => {
      openComponentStep('path', 'new', [], 'Add Directional Component');
    });
  }

  if (dom.modalChoiceAddPathBetweenNodesBtn) {
    dom.modalChoiceAddPathBetweenNodesBtn.addEventListener('click', () => {
      if (hasTwoSelectedNodes()) openComponentStep('path', 'existing', [], 'Add Directional Component (Start-End)');
    });
  }

  if (dom.modalChoiceAddNodeBetweenBtn) {
    dom.modalChoiceAddNodeBetweenBtn.addEventListener('click', () => {
      if (hasTwoSelectedNodes()) openAddNodeForm('crossing', 'Between');
    });
  }

  if (dom.modalChoiceAddNodeCornerBtn) {
    dom.modalChoiceAddNodeCornerBtn.addEventListener('click', () => {
      if (hasTwoSelectedNodes()) openAddNodeForm('crossing', 'Corner');
    });
  }

  if (dom.modalChoiceAddSimpleNodeBtn) {
    dom.modalChoiceAddSimpleNodeBtn.addEventListener('click', () => {
      openAddNodeForm('simple');
    });
  }

  if (dom.modalCompSelectBackBtn) {
    dom.modalCompSelectBackBtn.addEventListener('click', () => {
      showAddChoicePanels();
    });
  }

  dom.modalDeviceSelect.addEventListener('change', updateComponentFields);
  dom.modalAddBtn.addEventListener('click', handleModalAdd);

  if (dom.addNodeBackBtn) {
    dom.addNodeBackBtn.addEventListener('click', () => {
      showAddChoicePanels();
    });
  }

  if (dom.addNodeSubmitBtn) {
    dom.addNodeSubmitBtn.addEventListener('click', handleAddNodeSubmit);
  }
}

function openAddNodeForm(mode = 'simple', nodeType = 'Between') {
  activeNodeMode = mode;
  activeNodeType = nodeType;
  if (dom.addPanelsContainer) dom.addPanelsContainer.style.display = 'none';
  if (dom.addPanel) dom.addPanel.style.display = 'block';
  dom.modalStep1.style.display = 'none';
  dom.modalAddNodeStep.style.display = 'block';
  syncNodeFieldsFromSelection();

  const title = mode === 'simple' ? 'Add Directional Node' : nodeType === 'Between' ? 'Add Line Segment Node' : 'Add Corner Intersection Node';
  if (dom.modalTitle) dom.modalTitle.textContent = title;
  if (dom.addNodeSubmitBtn) dom.addNodeSubmitBtn.textContent = 'Add Node';

  dom.addNodeXLength.value = '2';
  dom.addNodeYLength.value = '-2';
  dom.addNodeLocation.value = '0.5';
  dom.addNodeCornerTypeSelect.value = '-|';

  updateAddNodeFormVisibility();
}

function updateAddNodeFormVisibility() {
  if (activeNodeMode === 'simple') {
    dom.addNodeRef2Group.style.display = 'none';
    dom.addNode1NodeFields.style.display = 'block';
    dom.addNode2NodesFields.style.display = 'none';
  } else {
    dom.addNodeRef2Group.style.display = 'block';
    dom.addNode1NodeFields.style.display = 'none';
    dom.addNode2NodesFields.style.display = 'block';

    if (activeNodeType === 'Between') {
      dom.addNodeBetweenFields.style.display = 'block';
      dom.addNodeCornerFields.style.display = 'none';
    } else {
      dom.addNodeBetweenFields.style.display = 'none';
      dom.addNodeCornerFields.style.display = 'block';
    }
  }
}

function handleAddNodeSubmit() {
  const [ref1, ref2 = ''] = getSelectedNodes();
  if (!ref1) {
    alert('Please select a Start Node on the circuit.');
    return;
  }

  const maxId = state.parsedData?.maxNodeId || 0;
  const newNodeName = `N${maxId + 1}`;

  if (activeNodeMode === 'crossing' && !ref2) {
    alert('Please select an End Node on the circuit for the Line Segment or Corner Intersection node.');
    return;
  }

  let line = '';

  if (!ref2) {
    const xlen = parseFloat(dom.addNodeXLength.value);
    const ylen = parseFloat(dom.addNodeYLength.value);

    if (isNaN(xlen) || isNaN(ylen)) {
      alert('Please enter valid numeric values for X and Y Directions.');
      return;
    }

    line = `\\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] \\draw [coloring] coordinate (${newNodeName}) at ($(${ref1})+(${xlen},${ylen})$); \\end{scope}`;
  } else {
    const type = activeNodeType;
    if (type === 'Between') {
      const locRaw = dom.addNodeLocation.value.trim() || '0.5';
      line = `\\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] \\draw [coloring] coordinate (${newNodeName}) at ($(${ref1})!${locRaw}!(${ref2})$); \\end{scope}`;
    } else if (type === 'Corner') {
      const cornerType = dom.addNodeCornerTypeSelect.value;
      line = `\\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] \\draw [coloring] coordinate (${newNodeName}) at (${ref1} ${cornerType} ${ref2}); \\end{scope}`;
    }
  }

  insertCircuitLine(line);
  clearSelectedNodes();
  closeDeviceModal();
  processLatexCode();
}

function updateComponentFields() {
  const type = dom.modalDeviceSelect.value;
  if (!type) {
    if (dom.modalPlacementNodeGroup) dom.modalPlacementNodeGroup.style.display = 'none';
    dom.modalStep2Fields.innerHTML = '';
    return;
  }

  const config = getComponentsConfig()[type] || (type === 'text' ? { style: 'node', isText: true } : null);
  if (!config) {
    if (dom.modalPlacementNodeGroup) dom.modalPlacementNodeGroup.style.display = 'none';
    dom.modalStep2Fields.innerHTML = '';
    return;
  }

  if (dom.modalCurrentNodeLabel) {
    dom.modalCurrentNodeLabel.textContent = config.style === 'path' ? 'Start Node' : 'Placement Node';
  }

  let fieldsHtml = '';

  if (config.style === 'path') {
    if (dom.modalPlacementNodeGroup) dom.modalPlacementNodeGroup.style.display = 'block';
    const targetFields = preferredPathMode === 'existing'
      ? `<div class="form-group">
          <label class="form-label">End Node</label>
          <input type="text" id="modalTargetNodeInput" class="form-input node-target-input" readonly placeholder="No node selected" value="${getSelectedNodes()[1] || ''}" />
        </div>`
      : `<div id="modalNewNodeFields">
        <div class="form-group">
          <label class="form-label">X Direction</label>
          <input type="number" step="0.1" id="modalXLengthInput" class="form-input" value="2.0" />
        </div>
        <div class="form-group">
          <label class="form-label">Y Direction</label>
          <input type="number" step="0.1" id="modalYLengthInput" class="form-input" value="-2.0" />
        </div>
      </div>`;
    fieldsHtml = targetFields;
  } else if (config.style === 'node') {
    if (config.isText) {
      if (dom.modalPlacementNodeGroup) dom.modalPlacementNodeGroup.style.display = 'block';
      fieldsHtml = `
        <div class="form-group">
          <label class="form-label">Text</label>
          <input type="text" id="modalTextLabel" class="form-input" required autofocus placeholder="Enter text" />
        </div>
      `;
    } else {
      if (dom.modalPlacementNodeGroup) dom.modalPlacementNodeGroup.style.display = 'block';
      const anchorOptions = (config.terminals || []).map(t => 
        `<option value="${t.name}">${t.displayName || t.name}</option>`
      ).join('');

      fieldsHtml = `
        <div class="form-group">
          <label class="form-label">Placement Pin</label>
          <select id="modalAnchorSelect" class="form-select">
            ${anchorOptions}
          </select>
        </div>
      `;
    }
  }

  dom.modalStep2Fields.innerHTML = fieldsHtml;
}

function handleModalAdd() {
  const type = dom.modalDeviceSelect.value;
  const config = getComponentsConfig()[type] || (type === 'text' ? { style: 'node', isText: true } : null);
  if (!type || !config) return;

  const start = getSelectedNodes()[0];
  if (!start) {
    alert(config.style === 'path' ? 'Please select a Start Node on the circuit.' : 'Please select a Placement Node on the circuit.');
    return;
  }

  if (config.style === 'path') {
    const targetNodeEl = document.getElementById('modalTargetNodeInput');
    const xLenEl = document.getElementById('modalXLengthInput');
    const yLenEl = document.getElementById('modalYLengthInput');

    const targetVal = targetNodeEl?.value.trim() || '__NEW__';
    const labelArg = ',l^=\\normalsize{}';

    if (preferredPathMode === 'existing' && targetVal === '__NEW__') {
      alert('Please select an existing end node on the circuit.');
      return;
    }

    if (targetVal === '__NEW__') {
      const xlen = xLenEl ? parseFloat(xLenEl.value) : 2;
      const ylen = yLenEl ? parseFloat(yLenEl.value) : 2;

      if (isNaN(xlen) || isNaN(ylen)) {
        alert('Please enter valid numeric values for X and Y Directions.');
        return;
      }

      const maxId = state.parsedData?.maxNodeId || 0;
      const newEndNode = `N${maxId + 1}`;

      const newLine = `\\begin{scope}[transform shape, xscale=1.0, yscale=1.0, rotate=0] \\draw [coloring] (${start}) to[${config.symbol}${labelArg}] ($(${start})+(${xlen},${ylen})$) coordinate (${newEndNode}); \\end{scope}`;
      insertCircuitLine(newLine);
    } else {
      const newLine = `\\begin{scope}[transform shape, xscale=1.0, yscale=1.0, rotate=0] \\draw [coloring] (${start}) to[${config.symbol}${labelArg}] (${targetVal}); \\end{scope}`;
      insertCircuitLine(newLine);
    }

    clearSelectedNodes();
    closeDeviceModal();
    processLatexCode();
  } else if (config.style === 'node') {
    const textLabelEl = document.getElementById('modalTextLabel');
    const textLabel = textLabelEl?.value.trim() || '';
    if (config.isText && !textLabel) {
      textLabelEl?.setCustomValidity('Text is required.');
      textLabelEl?.reportValidity();
      return;
    }
    textLabelEl?.setCustomValidity('');
    const anchorEl = document.getElementById('modalAnchorSelect');
    const anchor = config.isText ? '' : (anchorEl ? anchorEl.value : '');
    const compName = getNextComponentName(type);
    const extraArgs = config.args ? `, ${config.args}` : '';

    const addNodeComponent = () => {
      const nodeOptions = config.isText
        ? `inner sep=0pt, color=coloring, label=above:\\normalsize{${textLabel}}`
        : `${config.symbol}${extraArgs}, color=coloring, anchor=${anchor}, label=above:\\normalsize{}`;
      const newLine = `\\begin{scope}[transform shape, xscale=1.0, yscale=1.0, rotate=0] \\draw [coloring] (${start}) node[${nodeOptions}] (${compName}) {}; \\end{scope}`;
      insertCircuitLine(newLine);
      clearSelectedNodes();
      closeDeviceModal();
      processLatexCode();
    };

    if (config.isText) {
      addNodeComponent();
    } else {
      fetchRenderedMetadata(type, anchor, addNodeComponent);
    }
  }
}