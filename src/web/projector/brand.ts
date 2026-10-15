// Editable branding for this fan/game prototype: a neutral, self-made style (no official logo or house style).
// It does not claim official affiliation with Harderwold Villa Resort or Landal. Override via assets/branding.json.
export const BRAND = {
  teal: '#1f6f78',
  tealDark: '#154f56',
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
