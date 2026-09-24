# VisioDoc — App Mobile (React Native / Expo)

App mobile de télémédecine VisioDoc (patient + médecin). Même backend Supabase que l'app web.

## Stack

- **Expo SDK 51** + **Expo Router v3** (navigation par fichiers)
- **TypeScript**, **NativeWind v4** (Tailwind) — thème repris de la maquette
- **Supabase** (`@supabase/supabase-js`) — auth, données, Edge Functions
- **Jitsi** (`@jitsi/react-native-sdk`) — consultations vidéo
- Icônes : `lucide-react-native`

## Démarrage

```bash
cd visiodoc-app
npm install
cp .env.example .env        # renseigner les clés Supabase (mêmes que le web)
npx expo start
```

Ouvrir avec **Expo Go** (Android/iOS) pour l'UI. La visio Jitsi nécessite un **dev build**
(`npx expo prebuild` + EAS/local) car elle embarque du code natif.

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
