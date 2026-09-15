import { state } from './state.js';
import { render } from './render.js';
import { populateComponentDropdown, loadComponentsConfig } from './tikz.js';
import { processLatexCode, initializeTexHistory, recordTexEdit, undoTexEdit, redoTexEdit, loadSavedTexCode, saveTexCode } from './latex.js';
import { selectComponent, initModalListeners, closeDeviceModal, clearSelectedNodes } from './handlers.js';
import { clearTooltips } from './interactive.js';

export const dom = {
  scratchpad: document.getElementById('scratchpad'),
  latexInput: document.getElementById('latexInput'),
  output: document.getElementById('output'),
  downloadBtn: document.getElementById('downloadBtn'),
  toggleNodesBtn: document.getElementById('toggleNodesBtn'),
  copyTexBtn: document.getElementById('copyTexBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  addPanelsContainer: document.getElementById('addPanelsContainer'),
  addComponentsPanel: document.getElementById('addComponentsPanel'),
  addNodesPanel: document.getElementById('addNodesPanel'),
  addPanel: document.getElementById('addPanel'),
  modalTitle: document.getElementById('modalTitle'),
  modalDeviceSelect: document.getElementById('modalDeviceSelect'),
  modalStep1: document.getElementById('modalStep1'),
  modalPlacementNodeGroup: document.getElementById('modalPlacementNodeGroup'),
  modalStep2Fields: document.getElementById('modalStep2Fields'),
  modalCurrentNodeLabel: document.getElementById('modalCurrentNodeLabel'),
  modalCurrentNode: document.getElementById('modalCurrentNode'),
  modalAddBtn: document.getElementById('modalAddBtn'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  modalChoiceStep: document.getElementById('modalChoiceStep'),
  modalChoiceAddNodeComponentBtn: document.getElementById('modalChoiceAddNodeComponentBtn'),
  modalChoiceAddTextComponentBtn: document.getElementById('modalChoiceAddTextComponentBtn'),
  modalChoiceAddPathNewNodeBtn: document.getElementById('modalChoiceAddPathNewNodeBtn'),
  modalChoiceAddPathBetweenNodesBtn: document.getElementById('modalChoiceAddPathBetweenNodesBtn'),
  modalChoiceAddNodeBetweenBtn: document.getElementById('modalChoiceAddNodeBetweenBtn'),
  modalChoiceAddNodeCornerBtn: document.getElementById('modalChoiceAddNodeCornerBtn'),
  modalChoiceAddSimpleNodeBtn: document.getElementById('modalChoiceAddSimpleNodeBtn'),
  modalCompSelectBackBtn: document.getElementById('modalCompSelectBackBtn'),
  modalAddNodeStep: document.getElementById('modalAddNodeStep'),
  addNodeCurrentNode: document.getElementById('addNodeCurrentNode'),
  addNodeRef2Group: document.getElementById('addNodeRef2Group'),
  addNodeRef2Input: document.getElementById('addNodeRef2Input'),
  addNode1NodeFields: document.getElementById('addNode1NodeFields'),
  addNode2NodesFields: document.getElementById('addNode2NodesFields'),
  addNodeBetweenFields: document.getElementById('addNodeBetweenFields'),
  addNodeCornerFields: document.getElementById('addNodeCornerFields'),
  addNodeXLength: document.getElementById('addNodeXLength'),
  addNodeYLength: document.getElementById('addNodeYLength'),
  addNodeLocation: document.getElementById('addNodeLocation'),
  addNodeCornerTypeSelect: document.getElementById('addNodeCornerTypeSelect'),
  addNodeBackBtn: document.getElementById('addNodeBackBtn'),
  addNodeSubmitBtn: document.getElementById('addNodeSubmitBtn'),
  editPanel: document.getElementById('editPanel'),
  editPanelTitle: document.getElementById('editPanelTitle'),
  editPanelBody: document.getElementById('editPanelBody'),
  editPanelCloseBtn: document.getElementById('editPanelCloseBtn')
};

export const SCALE = 28.452756;
export const DEVICE_BOX_SCALE = 1.0;

export const DIRS = {
  up:    { dx: 0,  dy: -1 },
  down:  { dx: 0,  dy: 1 },
  left:  { dx: -1, dy: 0 },
  right: { dx: 1,  dy: 0 }
};

export function createSVGElement(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val);
  }
  return el;
}

function prepareExportSource(source) {
  const circuitMatch = source.match(/\\begin\{circuitikz\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{circuitikz\}/);
  const circuitBody = circuitMatch ? circuitMatch[1] : source;
  const visibleCode = circuitBody
    .split('\n')
    .filter(line => !/circle\s*\(3pt\)/.test(line))
    .join('\n')
    .trim();

  return `\\documentclass[border=0pt, varwidth]{standalone}
\\usepackage{circuitikz}
\\usepackage{xcolor}
\\begin{document}
\\begin{circuitikz}[american]
  %% -- Visible tex code to the user --
  ${visibleCode}
\\end{circuitikz}
\\end{document}`;
}

function downloadTextFile(content, filename) {
  const textBlob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const textUrl = URL.createObjectURL(textBlob);
  const textLink = document.createElement('a');
  textLink.href = textUrl;
  textLink.download = filename;
  document.body.appendChild(textLink);
  textLink.click();
  textLink.remove();
  setTimeout(() => URL.revokeObjectURL(textUrl), 1000);
}

async function copyTexToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const copyArea = document.createElement('textarea');
  copyArea.value = text;
  copyArea.style.position = 'fixed';
  copyArea.style.opacity = '0';
  document.body.appendChild(copyArea);
  copyArea.select();
  document.execCommand('copy');
  copyArea.remove();
}

function stripDocumentWrappers(source) {
  return source
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '');
}

async function embedExternalStyles(svg) {
  const stylesheets = [...document.querySelectorAll('link[rel="stylesheet"]')];
  const cssParts = await Promise.all(stylesheets.map(async (link) => {
    try {
      const href = link.href;
      const css = await fetch(href).then(response => response.text());
      return css.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, quote, path) => {
        try {
          return `url("${new URL(path, href).href}")`;
        } catch {
          return match;
        }
      });
    } catch (error) {
      console.warn(`Could not embed stylesheet ${link.href}:`, error);
      return '';
    }
  }));

  const css = cssParts.filter(Boolean).join('\n');
  if (!css) return;

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = css;
  svg.insertBefore(style, svg.firstChild);
}

function renderExportSvg(exportSource) {
  return new Promise((resolve, reject) => {
    const tikzSource = stripDocumentWrappers(exportSource);

    dom.scratchpad.innerHTML = '';
    const script = document.createElement('script');
    script.type = 'text/tikz';
    script.setAttribute('data-tex-packages', JSON.stringify({ circuitikz: '', xcolor: '', pgf: '', calc: '' }));
    script.textContent = tikzSource;
    dom.scratchpad.appendChild(script);

    try {
      const result = window.TikzJax?.process?.();
      if (result && typeof result.catch === 'function') {
        result.catch(reject);
      }
    } catch (error) {
      reject(error);
      return;
    }

    let attempts = 0;
    const poll = setInterval(() => {
      const svg = dom.scratchpad.querySelector('svg:not(.tikzjax-loader)');
      if (svg) {
        clearInterval(poll);
        embedExternalStyles(svg).then(() => resolve(svg)).catch(reject);
      } else if (++attempts >= 300) {
        clearInterval(poll);
        reject(new Error('Timed out while rendering export SVG'));
      }
    }, 40);
  });
}

async function init() {
  await loadComponentsConfig();
  await populateComponentDropdown();
  initModalListeners();

  if (dom.editPanelCloseBtn) {
    dom.editPanelCloseBtn.addEventListener('click', () => selectComponent(null));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearTooltips();
      selectComponent(null);
      clearSelectedNodes();
    }
  });

  dom.toggleNodesBtn?.addEventListener('click', () => {
    state.hideNodes = !state.hideNodes;
    dom.toggleNodesBtn.textContent = state.hideNodes ? 'Show nodes' : 'Hide nodes';
    if (state.hideNodes) selectComponent(null);
    processLatexCode();
  });

  let latexInputDebounce = null;
  dom.latexInput.addEventListener('input', () => {
    recordTexEdit();
    saveTexCode();
    clearTimeout(latexInputDebounce);
    latexInputDebounce = setTimeout(() => {
      processLatexCode();
    }, 400);
  });

  dom.downloadBtn?.addEventListener('click', async () => {
    const source = dom.latexInput.value || state.latexSource || '';
    const exportSource = prepareExportSource(source);
    const enableSourceDownloads = false;
    if (exportSource) {
      if (enableSourceDownloads) {
        downloadTextFile(exportSource, 'download.tex');
        downloadTextFile(stripDocumentWrappers(source), 'render.tex');
      }
      try {
        const svgNode = await renderExportSvg(exportSource);
        svgNode.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        const svgMarkup = new XMLSerializer().serializeToString(svgNode);
        const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        const svgUrl = URL.createObjectURL(svgBlob);
        const svgLink = document.createElement('a');
        svgLink.href = svgUrl;
        svgLink.download = 'circuit.svg';
        document.body.appendChild(svgLink);
        svgLink.click();
        svgLink.remove();
        setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
      } catch (error) {
        console.warn('TikZJax export render error:', error);
      }
    }

    if (enableSourceDownloads) {
      const textContent = dom.latexInput.value || state.latexSource || '';
      downloadTextFile(textContent, 'display.tex');
    }
  });

  dom.copyTexBtn?.addEventListener('click', async () => {
    const buttonLabel = dom.copyTexBtn.textContent;
    try {
      await copyTexToClipboard(dom.latexInput.value || '');
      dom.copyTexBtn.textContent = 'Copied';
      setTimeout(() => {
        dom.copyTexBtn.textContent = buttonLabel;
      }, 1200);
    } catch (error) {
      console.warn('Could not copy TeX to clipboard:', error);
    }
  });

  dom.clearAllBtn?.addEventListener('click', () => {
    dom.latexInput.value = `\\definecolor{coloring}{HTML}{000000} \\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] \\draw (0,0) coordinate (N0); \\end{scope}`;
    recordTexEdit();
    closeDeviceModal();
    selectComponent(null);
    processLatexCode();
  });

  dom.undoBtn?.addEventListener('click', undoTexEdit);
  dom.redoBtn?.addEventListener('click', redoTexEdit);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDeviceModal();
      selectComponent(null);
    }
  });

  if (!dom.latexInput.value.trim()) {
    dom.latexInput.value = loadSavedTexCode();
  }

  if (!dom.latexInput.value.trim()) {
    dom.latexInput.value = `\\definecolor{coloring}{HTML}{000000} \\begin{scope}[transform shape, xscale=1, yscale=1, rotate=0] \\draw (0,0) coordinate (N0); \\end{scope}`;
  }

  initializeTexHistory();
  processLatexCode();
}

window.addEventListener('load', init);