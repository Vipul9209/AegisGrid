// Cedar authorization (open-source AWS policy language) evaluated in-process via cedar-wasm.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const cedar = require('@cedar-policy/cedar-wasm/nodejs');
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'policies');

export const POLICIES = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.cedar'))
    .map((f) => [f.replace('.cedar', ''), readFileSync(join(dir, f), 'utf8')]),
);

const description = (id) => (POLICIES[id].match(/^\/\/\s*(.+)$/m) ?? [])[1] ?? id;

export function authorize({ principal, action, resource }) {
  const pType = principal.kind === 'agent' ? 'Agent' : 'User';
  const res = cedar.isAuthorized({
    principal: { type: pType, id: principal.id },
    action: { type: 'Action', id: action },
    resource: { type: resource.type, id: resource.id },
    context: {},
    policies: { staticPolicies: POLICIES },
    entities: [
      { uid: { type: pType, id: principal.id }, attrs: { role: principal.role, facility: principal.facility ?? 'NETWORK', name: principal.name ?? principal.id }, parents: [] },
      { uid: { type: resource.type, id: resource.id }, attrs: resource.attrs ?? {}, parents: [] },
    ],
  });
  if (res.type !== 'success') return { allowed: false, reasons: [`Policy engine error: ${JSON.stringify(res.errors ?? res)}`], matched: [] };
  const allowed = res.response.decision === 'allow';
  const matched = res.response.diagnostics.reason;
  const reasons = matched.length ? matched.map(description) : [`No policy permits ${action} for ${principal.role.replace('_', ' ')} on this ${resource.type.toLowerCase()}.`];
  return { allowed, reasons, matched };
}

// What can this user do? Derived from the same Cedar policies, so the UI never disagrees with the server.
export function capabilities(user) {
  const can = (action, type, attrs = {}) => authorize({ principal: user, action, resource: { type, id: 'probe', attrs } }).allowed;
  return {
    create: can('CreateEmergency', 'Network'),
    approve: can('ApprovePlan', 'Plan', { feasible: true, responseMin: 1, timeLimitMin: 30, usesUniversalDonorBlood: false }),
    cancel: can('CancelEmergency', 'Emergency', { severity: 'critical' }),
    inventory: can('UpdateInventory', 'Facility', { facility: user.facility }),
    acknowledge: can('AcknowledgeRequest', 'Facility', { facility: user.facility }),
    setStatus: can('SetResourceStatus', 'Resource', { facility: user.facility }),
    reset: can('ResetDemo', 'Network'),
  };
}
