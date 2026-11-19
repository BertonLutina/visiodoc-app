# CI et sécurité automatisées

Quatre mécanismes GitHub, dans `.github/`.

## Ce que fait chaque workflow

- **`workflows/ci.yml`** : sur push et pull request vers `dev` et `main`, installe les dépendances (yarn, Node 22), lance `npx tsc --noEmit` puis `npx jest --ci`. Le workflow est à `contents: read`. TODO : passer `yarn install` en `--frozen-lockfile` quand `yarn.lock` aura été régénéré et committé.
- **`workflows/secrets-scan.yml`** : gitleaks sur tout l'historique (push et PR vers `dev` et `main`). Échoue si un secret est détecté.
- **`dependabot.yml`** : PR hebdomadaires de mise à jour (npm et GitHub Actions) vers `dev`. Les montées majeures d'Expo, React et React Native sont ignorées (à faire à la main avec `npx expo install --fix`).
- **`workflows/security-digest.yml`** : digest hebdomadaire (lundi 07h00 UTC, ou lancement manuel) sur `dev` et `main`. Fait un `npm audit` sur un lockfile généré à la volée (le dépôt est en yarn) et un scan semgrep de `app/` et `src/`, puis un seul appel à l'API Claude (`claude-sonnet-5-5`) qui compare au run précédent. Une ligne Notion est écrite à chaque run (même « RAS »), une issue GitHub (label `security-digest`) seulement s'il y a du nouveau. Pas de Trivy : aucun Dockerfile ni IaC dans le dépôt. L'état précédent est stocké sur la branche orpheline `security-digest-state`, créée automatiquement au premier run.

Les scripts sont dans `scripts/security-digest/` (`synthesize.mjs`, `publish.mjs`).

## Secrets à ajouter (par un ADMIN du dépôt)

Chris n'a que le droit WRITE : c'est Berton qui doit les ajouter dans *Settings > Secrets and variables > Actions > New repository secret* :

1. `ANTHROPIC_API_KEY` : clé API Anthropic dédiée à ce workflow.
2. `NOTION_API_TOKEN` : jeton de l'intégration Notion autorisée sur la base « Sécurité, Digest Visiodoc ».
3. `NOTION_DATA_SOURCE_ID` : identifiant de la source de données Notion de cette base.

Deux secrets supplémentaires, pour la notification Telegram (envoyée seulement quand le digest trouve du nouveau, message court sans détail de vulnérabilité, avec le lien de l'issue) :

4. `TELEGRAM_BOT_TOKEN` : jeton du bot Telegram.
5. `TELEGRAM_CHAT_ID` : identifiant de la conversation destinataire.

S'ils manquent, l'envoi Telegram est simplement sauté avec un message clair.

Sans les trois premiers secrets, le digest affiche un avertissement clair et se termine proprement (sans échec). Si le dépôt appartient à une organisation, `secrets-scan.yml` demande aussi un secret `GITLEAKS_LICENSE`.

## Activation du cron

Le déclencheur `schedule` de GitHub ne s'exécute **que depuis la branche par défaut (`main`)**. Le digest ne sera donc actif qu'une fois ces fichiers présents sur `main`. D'ici là, on peut le tester via *Actions > Security Digest mobile > Run workflow* (le workflow doit alors exister sur la branche choisie).
