#!/usr/bin/env node
// VisioDoc MOBILE (Expo / React Native). Lit les resultats bruts des scans (npm audit, semgrep), compare a
// l'etat precedent (docs/security-digest/state-<branche>.json, tenu sur la
// branche orpheline security-digest-state, jamais sur develop/main), et
// appelle l'API Claude (un seul appel, pas une session agent) pour produire
// une synthese : y a-t-il du nouveau, quelle gravite, quel resume en
// francais. Objectif : ne publier (Notion/issue GitHub) que si une vraie
// nouveaute apparait, jamais un "tout va bien" repete a chaque run.
//
// Entrees (variables d'environnement) :
//   BRANCH, COMMIT_SHA           identifient le run
//   AUDIT_JSON_PATH              sortie de `npm audit --json` (peut etre vide/absente)
//   SEMGREP_JSON_PATH            sortie de `semgrep --json`
//   PREVIOUS_STATE_PATH          etat precedent pour cette branche (JSON), ou vide si premier run
//   ANTHROPIC_API_KEY            cle API (compte pro), jamais affichee
// Sortie : ecrit le resultat JSON sur stdout, et le nouvel etat dans
//   NEW_STATE_PATH (fourni par le workflow).

import { readFileSync, writeFileSync, existsSync } from "node:fs";

function readJsonSafe(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return { parseError: true, rawPreview: readFileSync(path, "utf-8").slice(0, 2000) };
  }
}

const branch = process.env.BRANCH || "inconnue";
const commitSha = process.env.COMMIT_SHA || "inconnu";
const audit = readJsonSafe(process.env.AUDIT_JSON_PATH);
const semgrep = readJsonSafe(process.env.SEMGREP_JSON_PATH);
const previousState = readJsonSafe(process.env.PREVIOUS_STATE_PATH) || {
  branch,
  lastCommit: null,
  lastSummaryFr: "Premier run, aucun etat precedent.",
  openFindingsFingerprint: [],
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY manquante, synthese sautee (sortie propre, aucun resultat produit).");
  process.exit(0);
}

const prompt = `Tu es un analyste securite qui prepare un digest court pour un developpeur solo (Chris) qui gere VisioDoc mobile, l'application Expo / React Native (iOS et Android) d'une plateforme de teleconsultation medicale (donnees de sante). Cote mobile, les risques typiques : secrets embarques dans le bundle, stockage non securise (AsyncStorage au lieu de SecureStore), deep links, WebView, dependances natives. Il ne veut lire QUE ce qui a change depuis le dernier run et qui merite vraiment son attention : une vraie nouveaute exploitable, pas un rappel de ce qui est deja connu et traite.

Etat precedent (dernier digest publie pour la branche ${branch}) :
${JSON.stringify(previousState, null, 2)}

Resultats bruts de ce run (branche ${branch}, commit ${commitSha}) :

npm audit --json :
${audit ? JSON.stringify(audit).slice(0, 15000) : "(pas de resultat ou vide)"}

semgrep --json (app/ et src/) :
${semgrep ? JSON.stringify(semgrep).slice(0, 15000) : "(pas de resultat ou vide)"}

Consignes :
1. Compare aux resultats precedents. Une vulnerabilite deja signalee et toujours presente n'est PAS une nouveaute, sauf si sa gravite a change ou si tu juges qu'elle est maintenant reellement exploitable (explique pourquoi).
2. Pour chaque trouvaille haute/critique nouvelle, dis si le code concerne est reellement atteint par l'application (pas juste une dependance de dev jamais chargee en prod), en te basant sur les chemins de fichiers visibles dans les resultats.
3. Ignore le bruit : info/low sans lien avec une entree utilisateur, faux positifs evidents de semgrep sur du code de test.
4. Reponds UNIQUEMENT en JSON valide, aucun texte autour, avec cette forme exacte :
{
  "has_new": true/false,
  "severity": "Info" | "A corriger" | "Bloquant",
  "summary_fr": "resume en francais, 3-6 phrases maximum, sans tiret long",
  "items": ["point court 1", "point court 2"],
  "state_fingerprint": ["identifiant court et stable par trouvaille ouverte, pour la comparaison du prochain run"]
}
Si rien de nouveau et rien a corriger : has_new=false, severity="Info", summary_fr="Rien de nouveau depuis le dernier run.", items=[].`;

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: "claude-sonnet-5-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  }),
});

if (!response.ok) {
  const text = await response.text();
  console.error(`Appel API Claude en echec (${response.status}): ${text.slice(0, 500)}`);
  process.exit(0);
}

const data = await response.json();
const textBlock = data.content?.find((b) => b.type === "text")?.text || "{}";

let result;
try {
  result = JSON.parse(textBlock);
} catch {
  console.error("Reponse Claude non-JSON, abandon:", textBlock.slice(0, 500));
  process.exit(0);
}

const newState = {
  branch,
  lastCommit: commitSha,
  lastRunAt: new Date().toISOString(),
  lastSummaryFr: result.summary_fr,
  openFindingsFingerprint: result.state_fingerprint || [],
};

if (process.env.NEW_STATE_PATH) {
  writeFileSync(process.env.NEW_STATE_PATH, JSON.stringify(newState, null, 2));
}

console.log(JSON.stringify(result));
