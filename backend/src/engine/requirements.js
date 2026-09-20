// Turns free-text emergency descriptions into structured requirements.
// Default path is a deterministic rule-based parser; if AEGIS_LLM=bedrock the
// model (via Amazon Bedrock) is asked first and validated against the same schema.
import { BLOOD_GROUPS, SPECIALTIES } from '../data/seed.js';

const has = (t, re) => re.test(t);

function normaliseGroup(raw) {
  if (!raw) return null;
  const m = raw.toUpperCase().replace(/\s+/g, '').match(/^(AB|A|B|O)(\+|-|POS|NEG|POSITIVE|NEGATIVE)?$/);
  if (!m) return null;
  const sign = !m[2] ? null : m[2].startsWith('+') || m[2].startsWith('POS') ? '+' : '-';
  return sign ? `${m[1]}${sign}` : null;
}

export function extractWithRules(text) {
  const t = ` ${text} `.toLowerCase();

  let condition = 'general emergency';
  let specialist = null;
  if (has(t, /\b(trauma|accident|crash|collision|fracture|stabbed|stabbing|gunshot|hemorrhag\w*|bleed\w*)\b|fall from/)) {
    condition = 'critical trauma';
    specialist = 'trauma';
  } else if (has(t, /cardiac|heart|chest pain|\bmi\b|arrest|stemi/)) {
    condition = 'cardiac emergency';
    specialist = 'cardiac';
  } else if (has(t, /stroke|neuro|head injury|brain|seizure/)) {
    condition = 'neurological emergency';
    specialist = 'neuro';
  }
  for (const s of SPECIALTIES) if (has(t, new RegExp(`\\b${s}\\b`))) specialist = s;

  const critical = has(t, /critical|severe|life.?threatening|unstable|arrest|major/);
  const severity = critical ? 'critical' : has(t, /serious|urgent/) ? 'serious' : 'moderate';

  // time limit
  let timeLimitMin = severity === 'critical' ? 30 : severity === 'serious' ? 45 : 60;
  const tm = t.match(/(\d+)\s*(min|minute|minutes|mins|hour|hours|hr|hrs)\b/);
  if (tm) timeLimitMin = /^h/.test(tm[2]) ? Number(tm[1]) * 60 : Number(tm[1]);

  // blood
  const gm = text.match(/\b(AB|A|B|O)\s?(\+|-|pos(?:itive)?|neg(?:ative)?)(?=\s|$|[.,;)])/i);
  let group = gm ? normaliseGroup(gm[1] + gm[2]) : null;
  const bloodMentioned = has(t, /blood|transfus|bleed|hemorrhag|units?\b/) || condition === 'critical trauma' || !!group;
  const um = t.match(/(\d+)\s*units?/);
  const units = um ? Math.min(Number(um[1]), 10) : 2;
  const groupAssumed = bloodMentioned && !group;
  if (groupAssumed) group = 'O-'; // group unknown -> universal donor

  const icu = has(t, /\bicu\b|intensive/) || severity !== 'moderate';
  const ventilator = has(t, /ventilat|intubat|respirat|breathing|airway/) || severity === 'critical';
  const ambulance = !has(t, /no ambulance|own transport/);

  return {
    source: 'rules',
    patient: { summary: text.trim().slice(0, 200), condition, severity },
    timeLimitMin,
    needs: {
      icu,
      ventilator,
      blood: bloodMentioned ? { group, units, component: 'RBC', groupAssumed } : null,
      ambulance,
      specialist,
    },
  };
}

function validate(x, fallback) {
  try {
    const sev = ['critical', 'serious', 'moderate'].includes(x?.patient?.severity) ? x.patient.severity : fallback.patient.severity;
    const g = normaliseGroup(x?.needs?.blood?.group) ?? (x?.needs?.blood ? 'O-' : null);
    return {
      source: 'bedrock',
      patient: { summary: fallback.patient.summary, condition: String(x?.patient?.condition ?? fallback.patient.condition).slice(0, 80), severity: sev },
      timeLimitMin: Math.min(240, Math.max(5, Math.round(Number(x?.timeLimitMin) || fallback.timeLimitMin))),
      needs: {
        icu: !!x?.needs?.icu,
        ventilator: !!x?.needs?.ventilator,
        blood: x?.needs?.blood && BLOOD_GROUPS.includes(g)
          ? { group: g, units: Math.min(10, Math.max(1, Math.round(Number(x.needs.blood.units) || 2))), component: 'RBC', groupAssumed: !!x.needs.blood.groupAssumed }
          : null,
        ambulance: x?.needs?.ambulance !== false,
        specialist: SPECIALTIES.includes(x?.needs?.specialist) ? x.needs.specialist : null,
      },
    };
  } catch {
    return fallback;
  }
}

export async function extractRequirements(text) {
  const fallback = extractWithRules(text);
  if (process.env.AEGIS_LLM !== 'bedrock') return fallback;
  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const system =
      'You extract structured emergency-resource requirements. Reply with JSON only, no prose. Schema: ' +
      '{"patient":{"condition":string,"severity":"critical"|"serious"|"moderate"},"timeLimitMin":number,' +
      '"needs":{"icu":boolean,"ventilator":boolean,"blood":{"group":"O-"|"O+"|"A-"|"A+"|"B-"|"B+"|"AB-"|"AB+","units":number,"groupAssumed":boolean}|null,' +
      '"ambulance":boolean,"specialist":"trauma"|"cardiac"|"neuro"|"anesthesia"|null}}. ' +
      'You only structure the request; you never give medical advice. If blood group is unknown use O- with groupAssumed=true.';
    const res = await client.send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID,
        system: [{ text: system }],
        messages: [{ role: 'user', content: [{ text }] }],
        inferenceConfig: { maxTokens: 500, temperature: 0 },
      }),
    );
    const raw = res.output?.message?.content?.[0]?.text ?? '';
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return validate(json, fallback);
  } catch (err) {
    console.warn('[requirements] Bedrock extraction failed, using rules:', err.message);
    return fallback;
  }
}
