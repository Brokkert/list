// In-memory vervanger van src/cloud.js voor tests: geen netwerk, geen auth.
// Elke testrun start met een "ingelogde" gebruiker en een leeg cloud-profiel,
// zodat de app het onboarding-scherm toont en met een verse seed kan starten.

export const supabase = {};

export function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function getSessionUser() {
  return { id: 'test-uid', email: 'test@test.nl' };
}
export function onAuth() {
  return () => {};
}
export async function signInWithEmail() {}
export async function signOut() {}

export async function loadProfile() {
  return null;
}
export function saveProfileDebounced() {}
export function subscribeProfile() {
  return () => {};
}

export function getStatus() {
  return 'online';
}
export function getLastError() {
  return null;
}
export function onStatus() {
  return () => {};
}

export async function upsertShare() {}
export async function loadShare() {
  return null;
}
export async function deleteShare() {}

export async function legacyLoadProfile() {
  return null;
}
export async function legacyDeleteProfile() {}
