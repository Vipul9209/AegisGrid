// Fictional hospital network around Bangalore. All names are invented.
export const FACILITIES = [
  { id: 'F01', name: 'Cauvery General Hospital', lat: 12.9716, lng: 77.5946, region: 'central', kind: 'hospital' },
  { id: 'F02', name: 'Lakeview Trauma Centre', lat: 12.9352, lng: 77.6245, region: 'south-east', kind: 'trauma' },
  { id: 'F03', name: 'Northgate Medical College', lat: 13.0358, lng: 77.597, region: 'north', kind: 'hospital' },
  { id: 'F04', name: 'Whitefield Community Hospital', lat: 12.9698, lng: 77.75, region: 'east', kind: 'clinic' },
  { id: 'F05', name: 'Jayanagar Heart Institute', lat: 12.9308, lng: 77.5838, region: 'south', kind: 'hospital' },
  { id: 'F06', name: 'Yeshwanthpur Multispeciality', lat: 13.0285, lng: 77.54, region: 'north-west', kind: 'hospital' },
  { id: 'F07', name: 'Indiranagar Care Hospital', lat: 12.9784, lng: 77.6408, region: 'east', kind: 'hospital' },
  { id: 'F08', name: 'Electronic City Medical', lat: 12.8452, lng: 77.6602, region: 'south', kind: 'hospital' },
  { id: 'F09', name: 'Hebbal Neuro Centre', lat: 13.048, lng: 77.62, region: 'north', kind: 'trauma' },
  { id: 'F10', name: 'Malleshwaram Emergency Hospital', lat: 13.0035, lng: 77.571, region: 'north-west', kind: 'hospital' },
  { id: 'F11', name: 'Bannerghatta Road Hospital', lat: 12.893, lng: 77.597, region: 'south', kind: 'hospital' },
  { id: 'F12', name: 'Rajajinagar Blood Bank', lat: 12.991, lng: 77.552, region: 'west', kind: 'bloodbank' },
  { id: 'F13', name: 'HSR Layout Hospital', lat: 12.9116, lng: 77.6389, region: 'south-east', kind: 'hospital' },
  { id: 'F14', name: 'Marathahalli Medical', lat: 12.9569, lng: 77.701, region: 'east', kind: 'hospital' },
  { id: 'F15', name: 'Banashankari General', lat: 12.9255, lng: 77.5468, region: 'south-west', kind: 'hospital' },
  { id: 'F16', name: 'KR Puram Government Hospital', lat: 13.007, lng: 77.696, region: 'east', kind: 'hospital' },
  { id: 'F17', name: 'Airport Road Trauma Unit', lat: 12.95, lng: 77.67, region: 'east', kind: 'trauma' },
];

export const BLOOD_GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
export const SPECIALTIES = ['trauma', 'cardiac', 'neuro', 'anesthesia'];

// Deterministic PRNG so every reset gives the same network (repeatable demo).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = () => new Date().toISOString();

export function buildResources(seed = 2041) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const counters = { ICU_BED: 0, VENTILATOR: 0, AMBULANCE: 0, SPECIALIST: 0 };
  const out = [];
  const add = (type, facilityId, extra = {}) => {
    const n = ++counters[type] ?? 0;
    const label = { ICU_BED: 'ICU Bed', VENTILATOR: 'Ventilator', AMBULANCE: 'Ambulance', SPECIALIST: 'Specialist' }[type];
    out.push({
      id: `${type}-${String(n).padStart(3, '0')}`,
      type,
      facilityId,
      label: `${label} #${String(n).padStart(2, '0')}`,
      status: 'AVAILABLE',
      quantity: 1,
      available: 1,
      attrs: {},
      updatedAt: NOW(),
      ...extra,
    });
  };

  for (const f of FACILITIES) {
    const isBank = f.kind === 'bloodbank';
    const isClinic = f.kind === 'clinic';
    const big = f.kind === 'trauma' || f.kind === 'hospital';

    if (!isBank) {
      const beds = isClinic ? 3 : int(4, 9);
      const free = isClinic ? 0 : int(0, 3);
      for (let i = 0; i < beds; i++) add('ICU_BED', f.id, { status: i < free ? 'AVAILABLE' : 'IN_USE' });
      const vents = isClinic ? 2 : int(2, 6);
      const ventFree = isClinic ? 0 : int(0, 2);
      for (let i = 0; i < vents; i++) add('VENTILATOR', f.id, { status: i < ventFree ? 'AVAILABLE' : 'IN_USE' });
    }

    const ambs = isBank ? 1 : isClinic ? 1 : int(1, 2);
    for (let i = 0; i < ambs; i++) add('AMBULANCE', f.id, { status: rnd() < 0.75 ? 'AVAILABLE' : 'IN_USE' });

    if (big) {
      const specs = [...SPECIALTIES].sort(() => rnd() - 0.5).slice(0, int(1, 2));
      for (const s of specs) add('SPECIALIST', f.id, { attrs: { specialty: s }, status: rnd() < 0.7 ? 'AVAILABLE' : 'IN_USE' });
    }

    // Blood stock: one line per group (quantity = units of red cells).
    for (const g of BLOOD_GROUPS) {
      const stocked = isBank ? true : rnd() < 0.45;
      const units = isBank ? int(6, 18) : stocked ? int(1, 6) : 0;
      if (units === 0 && !isBank) continue;
      out.push({
        id: `BLOOD-${f.id}-${g.replace('+', 'pos').replace('-', 'neg')}`,
        type: 'BLOOD',
        facilityId: f.id,
        label: `Blood ${g} (red cells)`,
        status: units > 0 ? 'AVAILABLE' : 'IN_USE',
        quantity: units,
        available: units,
        attrs: { group: g, component: 'RBC' },
        updatedAt: NOW(),
      });
    }
  }
  return out;
}
