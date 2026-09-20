// In-memory state store. The same interface maps 1:1 onto DynamoDB
// (Resources, Emergencies, Events tables) for a persistent version.
import { FACILITIES, buildResources } from './data/seed.js';

const OFFLINE_FEEDS = { F09: 42, F15: 27 }; // facilities whose data feed dropped (minutes since last sync)

function buildMeta() {
  return Object.fromEntries(
    FACILITIES.map((f, i) => [
      f.id,
      {
        phone: `080 4${String(100 + i * 7).padStart(3, '0')} ${1000 + i * 137}`,
        connected: !(f.id in OFFLINE_FEEDS),
        lastSyncAt: Date.now() - (f.id in OFFLINE_FEEDS ? OFFLINE_FEEDS[f.id] : 1 + (i % 4)) * 60000,
      },
    ]),
  );
}

export function createStore() {
  const state = { facilities: FACILITIES, meta: {}, resources: [], emergencies: new Map(), events: [], outbox: [], seq: 2040 };
  state.reset = () => {
    state.resources = buildResources();
    state.meta = buildMeta();
    state.emergencies = new Map();
    state.events = [];
    state.outbox = [];
    state.seq = 2040;
  };
  state.reset();
  return state;
}
