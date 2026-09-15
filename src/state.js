export const CENTER = { x: 1200, y: 800 };

export const state = {
  selectedComponentColor: null,
  selectedNodes: [],
  colorMap: {},
  componentCache: {},
  latexSource: '',
  hideNodes: false,
  texUndoStack: [],
  texRedoStack: [],
  parsedData: {
    nodes: [],
    components: [],
    terminalNodeLines: [],
    availableNodes: [],
    nodeCoords: {},
    maxNodeId: 0
  }
};

export function resetState() {
  state.selectedComponentColor = null;
  state.selectedNodes = [];
  state.colorMap = {};
  state.componentCache = {};
  state.latexSource = '';
  state.hideNodes = false;
  state.texUndoStack = [];
  state.texRedoStack = [];
  state.parsedData = {
    nodes: [],
    components: [],
    terminalNodeLines: [],
    availableNodes: [],
    nodeCoords: {},
    maxNodeId: 0
  };
}

export function getAllAvailableNodes(componentsConfig = {}) {
  if (state.parsedData && Array.isArray(state.parsedData.availableNodes)) {
    return state.parsedData.availableNodes;
  }
  return [];
}

export function getNodeCoordinates(nodeRef) {
  if (!nodeRef || !state.parsedData || !state.parsedData.nodeCoords) return null;
  
  if (typeof nodeRef === 'number') {
    nodeRef = `N${nodeRef}`;
  }
  
  const coords = state.parsedData.nodeCoords[nodeRef];
  if (coords) return coords;
  
  if (nodeRef.includes('.')) {
    const [compName, termName] = nodeRef.split('.');
    const comp = state.parsedData.components?.find(c => c.name === compName);
    if (comp) {
      const baseCoords = getNodeCoordinates(comp.node);
      if (baseCoords) {
        const cacheKey = `${comp.type}_${comp.anchor}`;
        const cache = state.componentCache[cacheKey];
        if (cache && cache.pins) {
          const devScale = comp.scale || 1.0;
          const anchorPin = cache.pins[comp.anchor] || { dx: 0, dy: 0 };
          const targetPin = cache.pins[termName] || { dx: 0, dy: 0 };
          
          return {
            x: baseCoords.x + (targetPin.dx - anchorPin.dx) * devScale,
            y: baseCoords.y + (targetPin.dy - anchorPin.dy) * devScale
          };
        }
        return baseCoords;
      }
    }
  }
  
  return null;
}