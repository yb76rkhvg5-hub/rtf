// RoadToFTP – App-Sperre mit Face ID / Touch ID (WebAuthn, Plattform-Authentifikator des iPhones)
// Schützt die Oberfläche vor fremdem Zugriff auf ein entsperrtes Gerät. Geprüft wird lokal; es verlässt nichts das Gerät.
"use strict";
(function () {
  const KEY = "rtf-state-v1";
  const RELOCK_MS = 5 * 60 * 1000; // nach 5 Minuten im Hintergrund wieder sperren
  const readState = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const credId = () => readState().ui?.lock?.credId || null;
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rnd = n => crypto.getRandomValues(new Uint8Array(n));

  // Schutz gegen Einbetten (Clickjacking): In einem fremden Rahmen wird nichts angezeigt.
  // GitHub Pages erlaubt keine eigenen Server-Regeln (frame-ancestors), daher hier im Skript.
  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location.replace(window.self.location.href); } catch { /* fremde Seite blockiert die Umleitung – bleibt leer */ }
    return;
  }

  // So früh wie möglich sperren (dieses Skript läuft im <head>, bevor Inhalte gezeichnet werden)
  if (credId()) document.documentElement.classList.add("locked");

  async function unlock() {
    const id = credId();
    if (!id) { document.documentElement.classList.remove("locked"); return true; }
    try {
      await navigator.credentials.get({ publicKey: {
        challenge: rnd(32), timeout: 60000, userVerification: "required",
        allowCredentials: [{ type: "public-key", id: unb64(id) }] } });
      document.documentElement.classList.remove("locked");
      return true;
    } catch (e) {
      const m = document.getElementById("lockMsg");
      if (m) m.textContent = "Entsperren abgebrochen. Erneut versuchen.";
      return false;
    }
  }

  async function enable() {
    if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.()))
      throw new Error("Face ID / Touch ID ist in diesem Browser nicht verfügbar.");
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rnd(32), timeout: 60000,
      rp: { name: "RoadToFTP" },
      user: { id: rnd(16), name: "RoadToFTP", displayName: "RoadToFTP App-Sperre" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
    } });
    return b64(cred.rawId);
  }

  window.RTFLock = { unlock, enable, isEnabled: () => !!credId() };

  // Nach längerer Zeit im Hintergrund erneut sperren
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (credId() && hiddenAt && Date.now() - hiddenAt > RELOCK_MS) document.documentElement.classList.add("locked");
  });
  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("lockBtn");
    if (btn) btn.addEventListener("click", unlock);
  });
})();
