import { SCALE, dom } from './main.js';
import { CENTER, state } from './state.js';
import { getComponentsConfig } from './tikz.js';
import { render } from './render.js';
import { normalizeColor } from './interactive.js';

let lastTexValue = '';
const TEX_STORAGE_KEY = 'circuitio.texCode';
const TEX_HISTORY_STORAGE_KEY = 'circuitio.texHistory';
const MAX_TEX_HISTORY = 20;

export function saveTexCode() {
  try {
    localStorage.setItem(TEX_STORAGE_KEY, dom.latexInput.value);
  } catch (error) {
    console.warn('Could not save TeX code to local storage:', error);
  }
}

export function loadSavedTexCode() {
  try {
    return localStorage.getItem(TEX_STORAGE_KEY) || '';
  } catch (error) {
    console.warn('Could not load TeX code from local storage:', error);
    return '';
  }
}

function updateHistoryButtons() {
  if (dom.undoBtn) dom.undoBtn.disabled = state.texUndoStack.length === 0;
  if (dom.redoBtn) dom.redoBtn.disabled = state.texRedoStack.length === 0;
}

function saveTexHistory() {
  try {
    localStorage.setItem(TEX_HISTORY_STORAGE_KEY, JSON.stringify({
      currentValue: dom.latexInput.value,
      undo: state.texUndoStack.slice(-MAX_TEX_HISTORY),
      redo: state.texRedoStack.slice(-MAX_TEX_HISTORY)
    }));
  } catch (error) {
    console.warn('Could not save TeX history to local storage:', error);
  }
}

function loadTexHistory(currentValue) {
  try {
    const savedHistory = JSON.parse(localStorage.getItem(TEX_HISTORY_STORAGE_KEY) || 'null');
    if (!savedHistory || savedHistory.currentValue !== currentValue) return null;
    if (!Array.isArray(savedHistory.undo) || !Array.isArray(savedHistory.redo)) return null;

    return {
      undo: savedHistory.undo.filter(value => typeof value === 'string').slice(-MAX_TEX_HISTORY),
      redo: savedHistory.redo.filter(value => typeof value === 'string').slice(-MAX_TEX_HISTORY)
    };
  } catch (error) {
    console.warn('Could not load TeX history from local storage:', error);
    return null;
  }
}

export function initializeTexHistory() {
  lastTexValue = dom.latexInput.value;
  const savedHistory = loadTexHistory(lastTexValue);
  state.texUndoStack = savedHistory?.undo || [];
  state.texRedoStack = savedHistory?.redo || [];
  updateHistoryButtons();
}

export function recordTexEdit() {
  const nextValue = dom.latexInput.value;
  if (nextValue === lastTexValue) return;
  state.texUndoStack.push(lastTexValue);
  state.texUndoStack = state.texUndoStack.slice(-MAX_TEX_HISTORY);
  state.texRedoStack = [];
  lastTexValue = nextValue;
  saveTexHistory();
  updateHistoryButtons();
}

export function undoTexEdit() {
  if (!state.texUndoStack.length) return;
  state.texRedoStack.push(dom.latexInput.value);
  state.texRedoStack = state.texRedoStack.slice(-MAX_TEX_HISTORY);
  dom.latexInput.value = state.texUndoStack.pop();
  lastTexValue = dom.latexInput.value;
  saveTexCode();
  saveTexHistory();
  updateHistoryButtons();
  processLatexCode();
}

export function redoTexEdit() {
  if (!state.texRedoStack.length) return;
  state.texUndoStack.push(dom.latexInput.value);
  state.texUndoStack = state.texUndoStack.slice(-MAX_TEX_HISTORY);
  dom.latexInput.value = state.texRedoStack.pop();
  lastTexValue = dom.latexInput.value;
  saveTexCode();
  saveTexHistory();
  updateHistoryButtons();
  processLatexCode();
}

const DEFAULT_DISPLAY_COLOR = '000000';

const TERMINAL_DISPLAY_COLOR = (() => {
  try {
    const cssVal = getComputedStyle(document.documentElement).getPropertyValue('--terminals-color').trim();
    return (cssVal || '#8c3b24').replace(/^#/, '').toLowerCase();
  } catch (e) {
    return '8c3b24';
  }
})();

export const COLOR_PREFIX_RE = /^\\definecolor\{coloring\}\{HTML\}\{([0-9a-fA-F]{6})\}\s*/;

function colorForIndex(index) {
  return index.toString(16).toLowerCase().padStart(6, '0');
}

function stripColorPrefix(line) {
  const match = line.match(COLOR_PREFIX_RE);
  if (match) {
    return { existingColor: match[1].toLowerCase(), rest: line.slice(match[0].length) };
  }
  return { existingColor: null, rest: line };
}

function colorizeLine(rest, colorKey) {
  if (!rest) return '';
  const cleanColorKey = colorKey ? colorKey.replace(/^#/, '') : '000000';
  const colorDef = `\\definecolor{coloring}{HTML}{${cleanColorKey}}`;

  // Safely normalize \draw and prevent duplicate [coloring] tags or stacked attributes
  const formattedRest = rest.replace(/\b\\draw(?:\s*\[coloring\])*/g, '\\draw [coloring]');

  if (formattedRest.includes('\\begin{scope}')) {
    return `${colorDef} ${formattedRest}`;
  }
  return `${colorDef} \\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] ${formattedRest} \\end{scope}`;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesPathSymbol(opts, symbol) {
  const trimmed = opts.trim();
  if (trimmed === symbol) return true;
  const prefix = symbol.toLowerCase();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith(prefix)) {
    const nextChar = lower.charAt(prefix.length);
    return nextChar === '=' || nextChar === ',' || nextChar === ' ' || nextChar === '[' || nextChar === '';
  }
  return false;
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

function parseScopeTransforms(scopeOptsStr) {
  if (!scopeOptsStr) return { xscale: 1.0, yscale: 1.0, rotate: 0 };
  const xs = scopeOptsStr.match(/xscale\s*=\s*(-?[0-9.]+)/i);
  const ys = scopeOptsStr.match(/yscale\s*=\s*(-?[0-9.]+)/i);
  const rot = scopeOptsStr.match(/rotate\s*=\s*(-?[0-9.]+)/i);
  return {
    xscale: xs ? parseFloat(xs[1]) : 1.0,
    yscale: ys ? parseFloat(ys[1]) : 1.0,
    rotate: rot ? parseFloat(rot[1]) : 0
  };
}

export function parseLatex(texString) {
  const componentsConfig = getComponentsConfig();
  const lines = texString.split('\n');

  let nodes = [];
  let components = [];
  let terminalNodeLines = [];
  let nodeCoords = {};
  let maxNodeId = 0;
  let definedNodeNames = new Set();

  lines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('%') || trimmed === '') return;

    const cleanLine = trimmed.split('%')[0].trim().replace(COLOR_PREFIX_RE, '');
    if (!cleanLine) return;

    const scopeMatch = cleanLine.match(/\\begin\{scope\}\[([^\]]*)\]/i);
    const scopeTransforms = scopeMatch ? parseScopeTransforms(scopeMatch[1]) : { xscale: 1.0, yscale: 1.0, rotate: 0 };

    // 1. Circle / Terminal Dot Marker Matching
    const markerMatch = cleanLine.match(/(?:\\nextGroup\s+)?(?:\\begin\{scope\}\[[^\]]*\]\s*)?\\draw\s*(?:\[[^\]]*\])?\s*\(([^)]+)\)\s*circle\s*\([^)]*\)\s*;/i);
    if (markerMatch) {
      const nodeRef = markerMatch[1].trim();
      terminalNodeLines.push({
        nodeRef,
        lineIndex: lineIdx,
        lineText: line
      });
      return;
    }

    // 2. Coordinate Definitions
    const isPathLine = /\bto\s*\[/i.test(cleanLine);
    const drawCoordMatch = !isPathLine && cleanLine.match(/(?:\\nextGroup\s+)?(?:\\begin\{scope\}\[[^\]]*\]\s*)?\\draw\s*(?:\[[^\]]*\])?\s*\((.+)\)\s+coordinate\s*\(([^)]+)\);/i);
    const legacyCoordMatch = !isPathLine && cleanLine.match(/(?:\\nextGroup\s+)?(?:\\begin\{scope\}\[[^\]]*\]\s*)?(?:\\draw\s*\[[^\]]*\]\s*)?\\?coordinate(?:\s*\[[^\]]*\])?\s+\(?([a-zA-Z0-9_\.]+)\)?\s+at\s*(.+);/i);

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
      definedNodeNames.add(nodeName);
      const idMatch = nodeName.match(/N?(\d+)/i);
      if (idMatch) {
        let nId = parseInt(idMatch[1], 10);
        if (nId > maxNodeId) maxNodeId = nId;
      }

      const betweenMatch = expr.match(/\$\s*\(?\s*([a-zA-Z0-9_\.]+)\)?\s*!\s*([^!]+)\s*!\s*\(?\s*([a-zA-Z0-9_\.]+)\)?\s*\$/);
      const calcMatch = expr.match(/\$\s*\(([^)]+)\)\s*\+\s*\(([^)]+)\)\s*\$/);
      const cornerMatch = expr.match(/\(?\s*([a-zA-Z0-9_\.]+)\s*(\-\||\|-)\s*([a-zA-Z0-9_\.]+)\s*\)?/);

      let xVal = CENTER.x, yVal = CENTER.y;

      if (betweenMatch) {
        const ref1 = betweenMatch[1].trim();
        const locStr = betweenMatch[2].trim();
        const ref2 = betweenMatch[3].trim();
        let frac = locStr.endsWith('%') ? parseFloat(locStr) / 100 : parseFloat(locStr);
        if (isNaN(frac)) frac = 0.5;

        const p1 = nodeCoords[ref1] || { x: CENTER.x, y: CENTER.y };
        const p2 = nodeCoords[ref2] || { x: CENTER.x, y: CENTER.y };

        xVal = p1.x + frac * (p2.x - p1.x);
        yVal = p1.y + frac * (p2.y - p1.y);

        nodes.push({
          name: nodeName,
          def: { type: 'between', ref1, ref2, location: locStr },
          y: yVal,
          lineIndex: lineIdx,
        });
      } else if (calcMatch) {
        const parentName = calcMatch[1].trim();
        const offsetParts = calcMatch[2].split(',').map(s => parseFloat(s.trim()));
        const p1 = nodeCoords[parentName] || { x: CENTER.x, y: CENTER.y };

        if (offsetParts.length === 2 && !isNaN(offsetParts[0]) && !isNaN(offsetParts[1])) {
          xVal = p1.x + offsetParts[0] * SCALE;
          yVal = p1.y - offsetParts[1] * SCALE;

          nodes.push({
            name: nodeName,
            def: { type: '1node', ref1: parentName, xlen: offsetParts[0], ylen: offsetParts[1] },
            x: xVal,
            y: yVal,
            lineIndex: lineIdx,
            lineText: line
          });
        }
      } else if (cornerMatch) {
        const ref1 = cornerMatch[1].trim();
        const cornerType = cornerMatch[2].trim();
        const ref2 = cornerMatch[3].trim();
        const p1 = nodeCoords[ref1] || { x: CENTER.x, y: CENTER.y };
        const p2 = nodeCoords[ref2] || { x: CENTER.x, y: CENTER.y };

        xVal = cornerType === '-|' ? p2.x : p1.x;
        yVal = cornerType === '-|' ? p1.y : p2.y;

        nodes.push({
          name: nodeName,
          def: { type: 'corner', ref1, ref2, cornerType },
          x: xVal,
          y: yVal,
          lineIndex: lineIdx,
          lineText: line
        });
      } else if (!expr.includes('$')) {
        const cleanExpr = expr.replace(/^\(|\)$/g, '');
        const parts = cleanExpr.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          xVal = CENTER.x + parts[0] * SCALE;
          yVal = CENTER.y - parts[1] * SCALE;
          nodes.push({
            name: nodeName,
            def: null,
            x: xVal,
            y: yVal,
            lineIndex: lineIdx,
            lineText: line
          });
        }
      }

      nodeCoords[nodeName] = { x: xVal, y: yVal };
      return;
    }

    // 3. Node Components
    const genericNodeMatch = cleanLine.match(/(?:\\nextGroup\s+)?(?:\\begin\{scope\}\[[^\]]*\]\s*)?\\draw\s*(?:\[[^\]]*\])?\s*\(([^)]+)\)\s+node\s*\[([^\]]+)\]\s*\(([^)]+)\)\s*\{\}\s*;/i);
    if (genericNodeMatch) {
      const nodeRef = genericNodeMatch[1].trim();
      const opts = genericNodeMatch[2].trim();
      const compName = genericNodeMatch[3].trim();
      const directLabelMatch = opts.match(/(?:^|,)\s*label\s*=\s*(above|below|left|right|center):\s*(\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge))\{([^{}]*)\}/i);
      const labelMatch = opts.match(/(?:^|,)\s*label\s*=\s*(?:(above|below|left|right|center):)?([^,]*)/i);

      const isText = /inner\s+sep\s*=\s*0pt/i.test(opts);
      const matchingTypes = isText
        ? [['text', { style: 'node', isText: true, terminals: [] }]]
        : Object.entries(componentsConfig).filter(([, cfg]) => {
          const sym = cfg.symbol.trim();
          return cfg.style === 'node' && new RegExp('(?:^|,|\\s)' + escapeRegExp(sym) + '(?:$|,|\\s)', 'i').test(opts);
        });

      matchingTypes.forEach(([typeKey, cfg]) => {
        const anchorMatch = opts.match(/anchor=([^,\s\]]+)/i);
        const anchor = anchorMatch ? anchorMatch[1].trim() : (cfg.terminals?.[0]?.name || '');

        components.push({
          style: 'node',
          type: typeKey,
          name: compName,
          node: nodeRef,
          anchor: cfg.isText ? '' : anchor,
          label: directLabelMatch ? directLabelMatch[3].trim() : labelMatch ? labelMatch[2].trim() : '',
          labelPosition: directLabelMatch ? directLabelMatch[1].toLowerCase() : labelMatch?.[1]?.toLowerCase() || 'above',
          labelSize: directLabelMatch ? directLabelMatch[2] : '\\normalsize',
          xscale: scopeTransforms.xscale,
          yscale: scopeTransforms.yscale,
          rotate: scopeTransforms.rotate,
          lineIndex: lineIdx,
          lineText: line
        });
      });
      return;
    }

    // 4. Path Components
    const genericPathMatch = cleanLine.match(/(?:\\nextGroup\s+)?(?:\\begin\{scope\}\[[^\]]*\]\s*)?\\draw\s*(?:\[[^\]]*\])?\s*\(([^)]+)\)\s+to\s*\[([^\]]*)\]\s*([^;]+);/i);
    if (genericPathMatch) {
      const start = genericPathMatch[1].trim();
      const opts = genericPathMatch[2].trim();
      const targetStr = genericPathMatch[3].trim();

      let end = '';
      const coordMatch = targetStr.match(/coordinate\s*\(([^)]+)\)/i);

      if (coordMatch) {
        end = coordMatch[1].trim();
        definedNodeNames.add(end);
        const idMatch = end.match(/^N(\d+)$/i);
        if (idMatch) {
          let nId = parseInt(idMatch[1], 10);
          if (nId > maxNodeId) maxNodeId = nId;
        }

        const exprPart = targetStr.replace(/coordinate\s*\([^)]+\)/i, '').trim();
        const calcMatch = exprPart.match(/\$\s*\(([^)]+)\)\s*\+\s*\(([^)]+)\)\s*\$/);
        if (calcMatch) {
          const parentName = calcMatch[1].trim();
          const offsetParts = calcMatch[2].split(',').map(s => parseFloat(s.trim()));
          const p1 = nodeCoords[parentName] || { x: CENTER.x, y: CENTER.y };
          if (offsetParts.length === 2 && !isNaN(offsetParts[0]) && !isNaN(offsetParts[1])) {
            const nx = p1.x + offsetParts[0] * SCALE;
            const ny = p1.y - offsetParts[1] * SCALE;
            nodeCoords[end] = { x: nx, y: ny };
          }
        }
      } else {
        const endMatch = targetStr.match(/\(([^)]+)\)/);
        end = endMatch ? endMatch[1].trim() : targetStr.trim();
      }

      Object.entries(componentsConfig).forEach(([typeKey, cfg]) => {
        if (cfg.style === 'path') {
          if (matchesPathSymbol(opts, cfg.symbol)) {
            const { label, labelPosition, labelSize } = parseLabelOption(opts);

            components.push({
              style: 'path',
              type: typeKey,
              start,
              end,
              xscale: scopeTransforms.xscale,
              yscale: scopeTransforms.yscale,
              rotate: scopeTransforms.rotate,
              ...(label ? { label } : {}),
              labelPosition,
              labelSize,
              lineIndex: lineIdx,
              lineText: line
            });
          }
        }
      });
      return;
    }
  });

  let availableNodes = Array.from(definedNodeNames);
  components.forEach(comp => {
    const config = componentsConfig[comp.type];
    if (config && config.style === 'node' && config.terminals) {
      config.terminals.forEach(term => {
        const pinRef = `${comp.name}.${term.name}`;
        if (!availableNodes.includes(pinRef)) {
          availableNodes.push(pinRef);
        }
      });
    }
  });

  return {
    nodes,
    components,
    terminalNodeLines,
    availableNodes,
    nodeCoords,
    maxNodeId
  };
}

export function processLatexCode(options = {}) {
  let rawInput = dom.latexInput.value;

  const cleanLines = rawInput.split('\n').filter(line => !/circle\s*\([^)]*\)/i.test(line));
  if (cleanLines.length !== rawInput.split('\n').length) {
    dom.latexInput.value = cleanLines.join('\n');
  }

  let texString = dom.latexInput.value;
  let parsed = parseLatex(texString);
  state.parsedData = parsed;

  const rawLines = texString.split('\n');
  let compiledLines = [];
  let visibleLines = [];
  let colorMap = {};
  let colorIndex = 0;
  let visibleChanged = false;

  rawLines.forEach((line, lineIdx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%')) {
      compiledLines.push(line);
      visibleLines.push(line);
      return;
    }

    const { existingColor, rest } = stripColorPrefix(trimmed);
    const displayColor = existingColor || DEFAULT_DISPLAY_COLOR;

    const visibleLine = colorizeLine(rest, displayColor);
    if (visibleLine !== line) visibleChanged = true;
    visibleLines.push(visibleLine);

    const renderColorKey = colorForIndex(colorIndex);
    colorIndex++;
    const renderLine = colorizeLine(rest, renderColorKey);
    compiledLines.push(renderLine);

    const compMatch = parsed.components.find(c => c.lineIndex === lineIdx);
    const nodeMatch = parsed.nodes.find(n => n.lineIndex === lineIdx);

    const meta = {
      lineNumber: lineIdx,
      lineText: visibleLine,
      color: renderColorKey,
      displayColor
    };

    if (compMatch) meta.component = compMatch;
    if (nodeMatch) meta.node = nodeMatch;

    colorMap[renderColorKey] = meta;
  });

  if (visibleChanged) {
    const selectionStart = dom.latexInput.selectionStart;
    const selectionEnd = dom.latexInput.selectionEnd;
    dom.latexInput.value = visibleLines.join('\n');
    try {
      dom.latexInput.setSelectionRange(selectionStart, selectionEnd);
    } catch (e) {}
  }

  const available = parsed.availableNodes || [];
  let terminalNodeLines = [];

  if (!state.hideNodes) available.forEach(nodeRef => {
    const colorKey = colorForIndex(colorIndex++);
    const colorDef = `\\definecolor{coloring}{HTML}{${colorKey}}`;
    const termLine = `${colorDef} \\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] \\draw [coloring, fill=coloring] (${nodeRef}) circle (3pt); \\end{scope}`;
    compiledLines.push(termLine);

    const meta = {
      nodeRef: nodeRef,
      color: colorKey,
      displayColor: TERMINAL_DISPLAY_COLOR,
      lineText: termLine
    };
    const nodeMatch = parsed.nodes.find(n => n.name === nodeRef);
    if (nodeMatch) {
      meta.lineNumber = nodeMatch.lineIndex;
      meta.node = nodeMatch;
    }

    colorMap[colorKey] = meta;
    terminalNodeLines.push({
      nodeRef,
      lineText: termLine
    });
  });

  parsed.terminalNodeLines = terminalNodeLines;

  saveTexCode();

  const headerTemplate = `\\documentclass[border=0pt, varwidth]{standalone}
\\usepackage{circuitikz}
\\usepackage{xcolor}

\\begin{document}

\\begin{circuitikz}[american]
`;

  const footerTemplate = `

\\end{circuitikz}

\\end{document}`;

  state.colorMap = colorMap;
  state.latexSource = headerTemplate + compiledLines.join('\n') + footerTemplate;

  if (state.selectedComponentColor) {
    const selNorm = normalizeColor(state.selectedComponentColor);
    const exists = Object.keys(colorMap).some(k => normalizeColor(k) === selNorm);
    if (!exists && !options.preserveSelection) {
      state.selectedComponentColor = null;
    }
  }

  if (!options.skipRender) {
    render();
  }
}

export function insertCircuitLine(newLine) {
  const text = dom.latexInput.value.trim();
  if (!text) {
    dom.latexInput.value = newLine;
  } else {
    dom.latexInput.value = text + '\n' + newLine;
  }
  recordTexEdit();
}

export function updateLineInTex(lineIndex, newLine) {
  const lines = dom.latexInput.value.split('\n');
  if (lineIndex >= 0 && lineIndex < lines.length) {
    lines[lineIndex] = newLine;
    dom.latexInput.value = lines.join('\n');
    recordTexEdit();
  }
}

export function deleteLineInTex(lineIndex) {
  const lines = dom.latexInput.value.split('\n');
  if (lineIndex >= 0 && lineIndex < lines.length) {
    lines.splice(lineIndex, 1);
    dom.latexInput.value = lines.join('\n');
    recordTexEdit();
  }
}