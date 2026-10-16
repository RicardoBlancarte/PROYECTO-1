// Bloque 2 de la Fase 3: límites por nivel para el navegador (solo lectura, sin secretos).
// Devuelve los límites ya resueltos (Elite "por definir" → tope visual) y los topes; no expone
// ENGINE_PARAMS. Es un endpoint aparte de /api/public-config, que responde 503 si falta Supabase.
import { TIER_LIMITS, UI_CAPS, tierLimits } from '../_shared/tier-config.js';

export async function onRequestGet() {
  const tiers = Object.fromEntries(Object.keys(TIER_LIMITS).map(tier => [tier, tierLimits(tier)]));
  return new Response(JSON.stringify({ tiers, uiCaps: UI_CAPS }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
