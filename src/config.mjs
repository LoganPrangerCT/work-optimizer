import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const configFilePath = join(project, 'config', 'settings.json');

let userConfig = {};
try {
  userConfig = JSON.parse(readFileSync(configFilePath, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.warn(`[config] Warning: Failed to parse config/settings.json (${err.message}). Using defaults.`);
  }
}

function extractHostname(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.hostname;
  } catch {
    return '';
  }
}

const bbBaseUrl = process.env.BB_BASE_URL || userConfig.bbBaseUrl || 'https://blackboard.example.edu';

export const config = {
  bbBaseUrl,
  bbSsoEntryUrl: process.env.BB_SSO_ENTRY_URL || userConfig.bbSsoEntryUrl || 'https://blackboard.example.edu',
  codexExecutable: process.env.WORK_OPTIMIZER_CODEX || userConfig.codexExecutable || 'codex',
  model: process.env.WORK_OPTIMIZER_MODEL || userConfig.model || 'gpt-6.1-terra',
  modelReasoningEffort: process.env.WORK_OPTIMIZER_REASONING_EFFORT || userConfig.modelReasoningEffort || 'medium',
  allowedDomains: Array.from(new Set([
    extractHostname(bbBaseUrl),
    ...(userConfig.allowedDomains || [])
  ].filter(Boolean)))
};
