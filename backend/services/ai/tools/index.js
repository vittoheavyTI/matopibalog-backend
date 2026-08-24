'use strict';

// Registro determinístico das tools READ-ONLY do AI Copilot V1.
// Chamar registerAllTools() uma vez (idempotente) antes de usar o registry.

const registry = require('../toolRegistry');
const fleetCurrentSummary = require('./fleetCurrentSummary');
const commercialPlanSummary = require('./commercialPlanSummary');
const operationFreightsAttention = require('./operationFreightsAttention');
const commandCenterSummary = require('./commandCenterSummary');

const ALL = [fleetCurrentSummary, commercialPlanSummary, operationFreightsAttention, commandCenterSummary];

let _registered = false;
function registerAllTools() {
  if (_registered) return;
  for (const t of ALL) registry.registerTool(t);
  _registered = true;
}

module.exports = { registerAllTools, ALL };
