#!/usr/bin/env node
// VisioDoc MOBILE. Publie le resultat de synthesize.mjs. Deux canaux avec des regles
// differentes (demande explicite de Chris, 11/11) :
//   - Notion : TOUJOURS une ligne, meme has_new=false ("RAS"). C'est la
//     trace d'audit : on doit pouvoir confirmer que le run a bien tourne
//     une semaine donnee, pas seulement voir les problemes.
//   - Issue GitHub : SEULEMENT si has_new=true. C'est le canal de
//     notification, pas besoin d'etre averti quand tout va bien.
// Lu depuis stdin (le JSON ecrit par synthesize.mjs sur sa sortie standard).
//
// Variables d'environnement :
//   NOTION_API_TOKEN, NOTION_DATA_SOURCE_ID   requis pour la ligne Notion (tous les runs)
//   GITHUB_TOKEN, GITHUB_REPOSITORY            requis seulement si has_new=true
//   BRANCH, COMMIT_SHA

const input = await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data));
});

if (!input.trim()) {
  console.log("Aucune synthese a publier (secret manquant ou appel API en echec plus haut), sortie propre.");
  process.exit(0);
}

let result;
try {
  result = JSON.parse(input);
} catch {
  console.error("Synthese illisible (JSON invalide), publication sautee.");
  process.exit(0);
}

const branch = process.env.BRANCH || "inconnue";
const commitSha = (process.env.COMMIT_SHA || "inconnu").slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
const severityMap = { Info: "Info", "A corriger": "À corriger", Bloquant: "Bloquant" };
const gravite = result.has_new ? severityMap[result.severity] || "Info" : "Info";

const bodyFr = result.has_new
  ? ["VisioDoc mobile.", "", result.summary_fr, "", ...(result.items || []).map((item) => `- ${item}`)].join("\n")
  : "RAS. Rien de nouveau depuis le run précédent sur cette branche.";

let notionUrl = null;
let issueUrl = null;

// --- Notion : toujours une ligne, trace d'audit ---
const notionToken = process.env.NOTION_API_TOKEN;
const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
if (notionToken && dataSourceId) {
  const notionRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${notionToken}`,
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { data_source_id: dataSourceId },
      properties: {
        Nom: { title: [{ text: { content: `${today} mobile (${branch}, ${commitSha})` } }] },
        Date: { date: { start: today } },
        "Gravité": { select: { name: gravite } },
        "Branche": { select: { name: branch === "main" ? "main" : "dev" } },
        "Commit": { rich_text: [{ text: { content: commitSha } }] },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: bodyFr.slice(0, 2000) } }] },
        },
      ],
    }),
  });
  if (!notionRes.ok) {
    console.error(`Publication Notion en echec (${notionRes.status}): ${(await notionRes.text()).slice(0, 500)}`);
  } else {
    console.log(`Publie sur Notion (${gravite}).`);
    try {
      notionUrl = (await notionRes.json()).url || null;
    } catch {}
  }
} else {
  console.error("NOTION_API_TOKEN ou NOTION_DATA_SOURCE_ID absent, publication Notion sautee.");
}

// --- GitHub issue : seulement si nouveaute reelle (canal de notification) ---
if (!result.has_new) {
  console.log("Rien de nouveau : pas d'issue GitHub (ligne Notion deja ecrite ci-dessus).");
  process.exit(0);
}

const ghToken = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (ghToken && repo) {
  const title = `[Digest sécurité mobile] ${gravite} — ${branch} (${commitSha}) — ${today}`;
  const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ghToken}`,
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      title,
      body: bodyFr,
      labels: ["security-digest", gravite === "Bloquant" ? "priority-high" : "priority-normal"],
    }),
  });
  if (!ghRes.ok) {
    console.error(`Creation issue GitHub en echec (${ghRes.status}): ${(await ghRes.text()).slice(0, 500)}`);
  } else {
    console.log("Issue GitHub creee.");
    try {
      issueUrl = (await ghRes.json()).html_url || null;
    } catch {}
  }
} else {
  console.error("GITHUB_TOKEN ou GITHUB_REPOSITORY absent, publication GitHub sautee.");
}

// --- Telegram : seulement si nouveaute reelle. Message volontairement court,
// SANS detail de vulnerabilite (Telegram est un tiers) : gravite, nombre de
// points et liens. TELEGRAM_DRY_RUN=1 affiche le message sans l'envoyer.
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
const tgChat = process.env.TELEGRAM_CHAT_ID;
const dryRun = process.env.TELEGRAM_DRY_RUN === "1";
if ((tgToken && tgChat) || dryRun) {
  const n = (result.items || []).length;
  const lines = [
    `Digest sécurité VisioDoc mobile (branche ${branch}) : gravité ${gravite}, ${n} nouveau${n > 1 ? "x" : ""} point${n > 1 ? "s" : ""}.`,
  ];
  if (issueUrl) lines.push(`Issue GitHub : ${issueUrl}`);
  if (notionUrl) lines.push(`Notion : ${notionUrl}`);
  const text = lines.join("\n");
  if (dryRun) {
    console.log("[dry-run Telegram] " + text);
  } else {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: true }),
      });
      console.log(tgRes.ok ? "Notification Telegram envoyee." : `Telegram en echec (${tgRes.status}), ignore.`);
    } catch (e) {
      console.error("Telegram injoignable, ignore.");
    }
  }
} else {
  console.error("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent, notification Telegram sautee.");
}
