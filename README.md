# VisioDoc — App Mobile (React Native / Expo)

App mobile de télémédecine VisioDoc (patient + médecin). Même backend Supabase que l'app web.

## Stack

- **Expo SDK 51** + **Expo Router v3** (navigation par fichiers)
- **TypeScript**, **NativeWind v4** (Tailwind) — thème repris de la maquette
- **Supabase** (`@supabase/supabase-js`) — auth, données, Edge Functions
- **Visio** — Edge Function `get-video-token` (JaaS / 8x8) ouverte dans une WebView (`react-native-webview`) ; SDK natif `@jitsi/react-native-sdk` = POC séparé, non installé
- Icônes : `lucide-react-native`

## Démarrage

```bash
cd visiodoc-app
npm install
cp .env.example .env        # renseigner les clés Supabase (mêmes que le web)
npx expo start
```

Ouvrir avec **Expo Go** (Android/iOS) pour l'UI. La visio (WebView + caméra/micro) et le paiement
nécessitent un **dev build** (`npx expo prebuild` + EAS/local) ; Expo Go ne suffit pas pour tester les permissions.

## Environnements EAS (UAT / Production)

`eas.json` sépare les builds de test de la Production et **ne contient aucune clé** :

| Profil | `EXPO_PUBLIC_APP_ENV` | Projet Supabase (`EXPO_PUBLIC_SUPABASE_URL`) |
|--------|-----------------------|----------------------------------------------|
| `development` | `development` | UAT — `pslypdfjmjetjhtpzwip` |
| `preview` | `uat` | UAT — `pslypdfjmjetjhtpzwip` |
| `production` | `production` | Production — `cftqxuxhsellvquidpxr` |

Aucun test, compte factice ni paiement d'essai sur Production. Les variables ci-dessous sont à définir
dans EAS (`eas env:create` ou le tableau de bord, **une valeur par environnement** `development` /
`preview` / `production`) **avant** de lancer un build. Ne jamais les écrire dans le dépôt.

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` : clé anonyme du projet Supabase correspondant (UAT pour `development` et `preview`, Production pour `production`). Sans elle, l'app retombe en mode mock.
- Paiement (widget Interswitch, voir `src/services/paymentWidget.ts`) : `EXPO_PUBLIC_ISW_MODE` (`TEST` ou `LIVE`), `EXPO_PUBLIC_ISW_MERCHANT_CODE`, `EXPO_PUBLIC_ISW_PAY_ITEM_ID`. Optionnelles : `EXPO_PUBLIC_ISW_SCRIPT_URL`, `EXPO_PUBLIC_ISW_REDIRECT_URL`. Valeurs à obtenir du backend ; sans elles le widget n'est pas configuré.
- `EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT` : `true` uniquement en `development` pour simuler localement le paiement prestataire ; ignorée dans les autres environnements.

`EXPO_PUBLIC_APP_ENV` vient de `eas.json` ; une valeur absente ou inconnue vaut `production`
(`src/config/appEnv.ts`). L'application n'a pas de sélecteur d'environnement : un build est lié à un seul projet.

## Avancement (4 phases)

| Phase | Contenu | État |
|------|---------|------|
| 1 | Frontend patient (11 écrans) + fondations | ✅ Fait |
| 2 | Lien backend patient (Supabase) | ✅ Fait |
| 3 | Frontend médecin (10 écrans) | ✅ Fait |
| 4 | Lien backend médecin | ✅ Fait |

### Backend (Phases 2 & 4)

Auth réelle via `supabase.auth` (`src/contexts/AuthContext.tsx`) + Edge Functions
`create-user` (patient) et `register-presta` (médecin). Couche données dans
`src/services/patientApi.ts` et `src/services/providerApi.ts`, en miroir des requêtes
de l'app web (tables `users`, `healthcare_professionals`, `consultations`,
`doctor_availability`, `medical_records`, `payment_fee_config`…).

**Mode dégradé** : sans fichier `.env`, les services renvoient les données mock pour que
l'UI tourne dans Expo Go. Dès que `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` sont renseignés,
les vraies données Supabase prennent le relais automatiquement.

⚠️ À tester contre la vraie base : les requêtes suivent le schéma de l'app web mais n'ont pas
pu être exécutées ici. Le portefeuille patient reste en mock (pas de table de solde patient
confirmée côté backend).

Voir `CODEX_PROMPTS.md` pour reprendre chaque lot ailleurs si besoin.

## Structure

```
app/                      # routes Expo Router
  index.tsx               # 1. Accueil public
  (auth)/register|login   # 2-3. Inscription / Connexion patient
  (patient)/              # bottom-tabs patient
    index                 # 4. Dashboard
    doctors               # 5. Recherche médecin
    appointments          # 7. Mes consultations
    wallet                # 9. Portefeuille
    profile               # 11. Mon profil
  doctor/[id]             # 6. Profil & réservation
  records                 # 10. Dossier médical
  call/[room]             # 8. Appel vidéo + IA
src/
  components/  theme/  types/  data/  lib/  contexts/  utils/
```

Les écrans utilisent des **données mock** (`src/data/mock.ts`) en Phase 1 ; la Phase 2 les
remplace par un service `src/services/patientApi.ts` branché sur Supabase.
