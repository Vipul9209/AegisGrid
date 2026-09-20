// AWS Lambda entry point (API Gateway HTTP API, payload v2). Same router as the local server.
import { handle } from './router.js';

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? event.httpMethod;
  const path = event.rawPath ?? event.path;
  let body = {};
  try { body = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : {}; } catch { /* ignore */ }
  const r = await handle({ method, path, body, headers: event.headers ?? {} });
  return { statusCode: r.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify(r.body) };
};
