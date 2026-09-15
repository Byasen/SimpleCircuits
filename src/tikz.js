import { state } from './state.js';
import { dom } from './main.js';

let componentsConfig = null;

export async function loadComponentsConfig() {
  if (componentsConfig) return componentsConfig;
  try {
    const response = await fetch('./components.json');
    componentsConfig = await response.json();
  } catch (err) {
    console.error('Failed to load components.json:', err);
  }
  return componentsConfig;
}

export function getComponentsConfig() {
  return componentsConfig || {};
}

export async function populateComponentDropdown(styleFilter = null, excludedTypes = []) {
  const config = await loadComponentsConfig();
  const selectEl = document.getElementById('modalDeviceSelect');
  if (!config || !selectEl) return;

  selectEl.innerHTML = '<option value="">-- Select Device --</option>';
  Object.keys(config).forEach(key => {
    if (styleFilter && config[key].style !== styleFilter) return;
    if (excludedTypes.includes(key)) return;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key;
    selectEl.appendChild(option);
  });
}

export async function fetchRenderedMetadata(type, anchorName, callback) {
  const config = await loadComponentsConfig();
  const compDef = config ? config[type] : null;

  const cacheKey = `${type}_${anchorName}`;
  if (state.componentCache[cacheKey]) {
    callback(state.componentCache[cacheKey]);
    return;
  }

  dom.scratchpad.innerHTML = "";
  let tikzNodeType = compDef ? compDef.symbol : type;
  let extraArgs = compDef && compDef.args ? `, ${compDef.args}` : '';

  let code = `\\begin{circuitikz}[american]\\draw (0,0) node[${tikzNodeType}${extraArgs}, scale=1.0] (test) {};\\end{circuitikz}`;

  const script = document.createElement("script");
  script.type = "text/tikz";
  script.setAttribute("data-tex-packages", JSON.stringify({ circuitikz: "", xcolor: "", pgf: "", calc: "" }));
  script.textContent = code;
  dom.scratchpad.appendChild(script);

  if (window.TikzJax && typeof window.TikzJax.process === "function") {
    try {
      const res = window.TikzJax.process();
      if (res && typeof res.catch === 'function') {
        res.catch(err => console.warn('TikZJax metadata render error:', err));
      }
    } catch (e) {
      console.warn('TikZJax process error:', e);
    }
  }

  let checkInterval = setInterval(() => {
    const svg = dom.scratchpad.querySelector("svg:not(.tikzjax-loader)");
    if (svg) {
      const targetEl = svg.querySelector("g") || svg;
      const bbox = targetEl.getBBox();

      if (bbox.width > 0 && bbox.height > 0) {
        clearInterval(checkInterval);
        
        let meta = {
          width: bbox.width,
          height: bbox.height,
          pins: {}
        };

        if (compDef && compDef.terminals) {
          compDef.terminals.forEach(term => {
            if (term.dxRatio !== undefined && term.dyRatio !== undefined) {
              meta.pins[term.name] = {
                dx: term.dxRatio * bbox.width,
                dy: term.dyRatio * bbox.height
              };
            }
          });
        }

        state.componentCache[cacheKey] = meta;
        callback(meta);
      }
    }
  }, 40);
}

let activePoll = null;

export function renderCircuit(onRendered) {
  if (activePoll) {
    clearInterval(activePoll);
    activePoll = null;
  }

  const source = state.latexSource || dom.latexInput.value;
  dom.output.innerHTML = "";

  if (!source || !source.trim()) {
    return;
  }

  // Silently strip document-level wrapper commands for TikZJax compilation
  const cleanSource = source
    .replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\begin\{document\}/g, '')
    .replace(/\\end\{document\}/g, '');

  const tikzScript = document.createElement("script");
  tikzScript.type = "text/tikz";
  tikzScript.setAttribute("data-tex-packages", JSON.stringify({ circuitikz: "", xcolor: "", pgf: "", calc: "" }));
  tikzScript.textContent = cleanSource;
  dom.output.appendChild(tikzScript);

  if (window.TikzJax && typeof window.TikzJax.process === "function") {
    try {
      const res = window.TikzJax.process();
      if (res && typeof res.catch === 'function') {
        res.catch(err => console.warn('TikZJax render error:', err));
      }
    } catch (e) {
      console.warn('TikZJax execution error:', e);
    }
  }

  if (typeof onRendered !== 'function') return;

  let attempts = 0;
  const maxAttempts = 300;

  const poll = setInterval(() => {
    attempts++;
    const svg = dom.output.querySelector('svg:not(.tikzjax-loader)');
    if (svg) {
      clearInterval(poll);
      activePoll = null;
      onRendered(svg);
      setTimeout(() => {
        const latestSvg = dom.output.querySelector('svg:not(.tikzjax-loader)');
        // Only re-run setup if TikZJax swapped in a new element, otherwise
        // this would double-bind click handlers and break selection toggles.
        if (latestSvg && latestSvg !== svg) onRendered(latestSvg);
      }, 200);
      return;
    }
    if (attempts >= maxAttempts) {
      clearInterval(poll);
      activePoll = null;
    }
  }, 40);

  activePoll = poll;
}