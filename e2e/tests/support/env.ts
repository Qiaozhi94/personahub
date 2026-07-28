/**
 * Single source of truth for the ports this suite's own throwaway
 * server/web instances run on. Deliberately NOT 4321/5173 (PersonaHub's
 * normal dev ports): if a developer already has `npm run dev` running,
 * reusing those ports would silently point every seed API call at their
 * real dev database instead of the isolated e2e.db this config sets up —
 * writing fixture Projects/Adapters/fake API keys into it.
 */
export const SERVER_PORT = Number(process.env.PERSONAHUB_E2E_SERVER_PORT ?? 14321);
export const WEB_PORT = Number(process.env.PERSONAHUB_E2E_WEB_PORT ?? 15173);
export const API_BASE = `http://127.0.0.1:${SERVER_PORT}/api`;
