// Editable branding: Harderwold house colours (navy + orange accent, supplied by the client). The neutral emblem
// stays until the client's logo is cleared for use in the game. Override via assets/branding.json.
export const BRAND = {
  teal: '#1f2a38', // primary colour (navy, Harderwold house style); key name kept from the base engine
  tealDark: '#151d27',
  accent: '#cc7400',
  white: '#ffffff',
  wordmark: 'Harderwold',
  parkName: 'Harderwold',
};
export async function loadBranding() {
  try {
    const r = await fetch('/assets/branding.json', { cache: 'no-store' });
    if (r.ok) Object.assign(BRAND, await r.json());
  } catch { /* defaults */ }
}
