// RoadToFTP – Tages-Automatik (Starter für Scriptable)
// Einmal in Scriptable einfügen. Lädt bei jedem Lauf die aktuelle Logik von der RoadToFTP-Adresse,
// liest deine Termine, passt den Plan an, sendet ihn an intervals.icu und trägt die Einheiten in deinen Kalender ein.
const BASE = "https://yb76rkhvg5-hub.github.io/rtf/";
const KEY = "roadtoftp-icu-key";

async function main() {
  if (!Keychain.contains(KEY)) {
    const a = new Alert();
    a.title = "RoadToFTP";
    a.message = "Bitte deinen intervals.icu API-Schlüssel einfügen (intervals.icu → Einstellungen → Entwicklereinstellungen).";
    a.addSecureTextField("API-Schlüssel");
    a.addAction("Speichern");
    a.addCancelAction("Abbrechen");
    if (await a.present() === -1) return "Abgebrochen";
    Keychain.set(KEY, a.textFieldValue(0).trim());
  }
  const load = async f => await new Request(BASE + f + "?t=" + Date.now()).loadString();
  const code = (await Promise.all(["planner.js", "calendar.js", "automation.js"].map(load))).join("\n;\n");
  const run = new Function("env", code + "\nreturn runAutomation(env);");
  return await run({
    key: Keychain.get(KEY), Request, Calendar, CalendarEvent, Notification, notify: true,
    btoa: s => Data.fromString(s).toBase64String(),
  });
}

try {
  const result = await main();
  console.log(result);
  Script.setShortcutOutput(result);
  if (config.runsInApp) { const a = new Alert(); a.title = "RoadToFTP"; a.message = result; a.addAction("OK"); await a.present(); }
} catch (e) {
  console.error(e);
  const n = new Notification(); n.title = "RoadToFTP – Fehler"; n.body = String(e.message || e); await n.schedule();
  Script.setShortcutOutput("Fehler: " + (e.message || e));
}
Script.complete();
