# Application mobile — tâches P1 et P2 de Berton (Planii, projet VisioDoc)

Mise à jour du 28 nov. 2026, **après `git pull origin dev`** (99 commits tirés, jusqu'au merge de la PR #16).
Les statuts viennent de la lecture du code et des commits, **pas d'un test sur appareil**. Dans Planii, toutes ces tâches
sont encore « À faire » : le tableau est en retard sur le code pour 30 d'entre elles.

Légende : ✅ fait dans le code · 🟡 partiel · ❌ à faire

> Planii ne charge que 100 tâches sur 272 sur la page projet (« Charger plus »). La liste vient donc de la page d'accueil de
> Berton (74 tâches). Les tâches P1/P2 de Yves et Chris (légal, sécurité, backend) ne sont pas incluses : elles ne sont pas mobiles.

## Résumé : 30 faites, 1 partielle, 4 à faire

| Statut | Nombre | Tâches |
|---|---|---|
| ✅ Fait | 30 | tout sauf les lignes ci-dessous |
| 🟡 Partiel | 1 | A19 (expiration de session : minuteurs d'inactivité et de durée max) |
| ❌ À faire | 4 | A23 (version minimale), B1 (Expo 58), B7 (revue des PR), B10 (documents d'onboarding) |

## Toutes les tâches

### Partie A — projet VisioDoc

| N° | Tâche | Statut | Constat dans le code |
|---|---|---|---|
| A1 | Régénérer yarn.lock (expo-notifications, expo-device) | ✅ | Les deux sont dans `package.json` et `yarn.lock` |
| A2 | Confirmation d'e-mail et renvoi du lien | ✅ | `ResendConfirmation`, utilisé à l'inscription et à la connexion |
| A3 | Inscription patient via le serveur (register-patient) | ✅ | `registerPatient` dans `registration.ts` |
| A4 | Paiements prestataire : référence avant le widget | ✅ | `registerProviderPaymentAttempt` (`paymentAttempt.ts`) |
| A5 | Téléphone facultatif (inscription, profil) | ✅ | Libellé « Téléphone (facultatif) » dans `register.tsx` et `profile-edit.tsx` |
| A6 | Coordonnées prestataires masquées | ✅ | `provider_identity` dans `patientApi.ts` |
| A7 | Créneaux occupés via doctor_busy_slots | ✅ | `availabilityApi.ts` |
| A8 | Dossier médical par personne (Moi / enfant) | ✅ | `app/records.tsx`, `recordPerson.ts`, accès des médecins |
| A9 | Inscription : naissance 18 ans, ville, commune, canal, paiement en attente | ✅ | `birthDate.ts`, ville/commune dans `register.tsx` ; canal et « pending_confirmation » dans `phone-login.tsx` (à vérifier sur appareil) |
| A10 | Paiement sécurisé en 3 temps | ✅ | `registerConsultationPayment`, `confirmConsultationPayment` |
| A11 | Réserver pour son enfant | ✅ | `bookingFor.ts`, `app/doctor/[id].tsx`, `app/children/*` |
| A12 | Prestataire : accepter les enfants, voir le patient enfant | ✅ | `AcceptsChildren`, `accepts_children`, badge enfant dans `consultations.tsx` |
| A13 | Aligner l'écran du prestataire sur le web | ✅ | Prochaine consultation, fenêtre de démarrage (`startWindow.ts`), « Absent » (`call/[room].tsx`), « Terminer la consultation » (rapport) |
| A14 | Dossier de l'enfant : jamais les données du parent | ✅ | `app/patient/[id].tsx` : enfant ou parent, jamais les deux |
| A15 | Garde sur doctor_status | ✅ | `accessPolicy.ts` |
| A16 | Genre obligatoire (prestataire) | ✅ | `register-provider.tsx` |
| A17 | Code WhatsApp et délai de renvoi | ✅ | `phone-login.tsx`, `otpDelivery.ts` |
| A18 | Contrôle du rôle à la connexion | ✅ | rôles admin refusés (`authError.ts`) |
| A19 | Expiration de session (30 min, 1 h d'inactivité, 12 h max) | 🟡 | Détection d'expiration et message unique faits ; aucun minuteur d'inactivité ni de durée max trouvé |
| A20 | Inscription par téléphone : e-mail et mot de passe | ✅ | `AuthContext`, `registration.ts` |
| A21 | Politique de mot de passe commune | ✅ | `passwordPolicy.ts` |
| A22 | Stockage sécurisé de la session | ✅ | `secureSessionStorage.ts` |
| A23 | Version minimale supportée | ❌ | Aucune lecture de la version minimale ni écran de blocage (`otpDelivery` dit même ne jamais lire `app_config`) |
| A24 | Catalogue sans tarif ni créneaux | ✅ | `public_provider_listing` |
| A25 | Environnements EAS UAT et Pro | ✅ | `eas.json`, `easEnv.test.ts` |

### Partie B — autres P2 de Berton

| N° | Tâche | Statut | Constat dans le code |
|---|---|---|---|
| B1 | Migration Expo 57 vers 58 (15 déc.) | ❌ | `expo ^57.0.24` |
| B2 | Notifications push | ✅ | `pushNotifications.ts`, `usePushNotifications.ts` (jeton, permission, tap) |
| B3 | Liste des notifications in-app | ✅ | `app/inbox.tsx`, `notifications.ts` (`in_app_notifications`) |
| B4 | Visio : écran noir, caméra/micro, nom du compte | ✅ | `displayName` passé à la salle (`videoToken.ts`) ; écran noir à vérifier sur appareil |
| B5 | Logo officiel, Poppins | ✅ | `theme/brand.ts`, `BrandLogo`, `_layout.tsx` ; vocabulaire : voir B9 |
| B6 | Rapport et fin de consultation | ✅ | `app/provider/consultation-report/[id].tsx` |
| B7 | Revue et fusion des PR ouvertes | ❌ | Tâche de gestion, pas de code |
| B8 | Retours du test d'annulation du 19/11 | ✅ | Annulation avec crédit (MOB-1811-7), solde, jour de la salle, cartes ; à vérifier sur appareil |
| B9 | Supprimer le mot « prestataire » | ✅ | Interface passée à « praticien » / « professionnel de santé » (28 nov., non commité) ; les traductions en/sw/ln gardent leurs valeurs |
| B10 | Documents d'onboarding du prestataire (étape 1 et 2) | ❌ | Aucun code de documents |

## Prompts pour ce qui reste

**A19. Expiration de session**
« Ajoute une déconnexion après 1 h d'inactivité (suivi des interactions de l'utilisateur) et au plus 12 h après la
connexion, en plus de l'expiration du jeton déjà gérée par `sessionExpiry.ts`. Affiche le même message "session expirée"
(via `createSessionExpiryTracker`) et purge la session. Tests avec horloge simulée pour : 59 min, 61 min d'inactivité,
11 h 59 et 12 h 01 depuis la connexion. »

**A23. Version minimale supportée**
« Au démarrage, lis la version minimale depuis la configuration publique du backend (confirme d'abord le nom exact de la
vue ou RPC avec Chris : `otpDelivery` dit que `app_config` n'est pas lisible directement) et compare-la à la version de
l'app (`expo-constants`). Si l'app est trop ancienne, affiche un écran bloquant "Mise à jour requise" avec un lien vers la
boutique. Si la lecture échoue, laisse l'app démarrer. Clés i18n (fr/en/sw/ln) et tests de la comparaison de versions. »

**B1. Migration Expo SDK 58**
« Sur une branche, lance `npx expo install expo@^58 --fix` puis `npx expo-doctor`, corrige les ruptures, vérifie
`npx tsc --noEmit` et `npx jest`, et liste ce qu'il reste à tester sur appareil (caméra/micro, push, paiement, datetimepicker).
Ne fusionne pas avant la cible de mi-décembre. »

**B7. Revue des PR ouvertes**
« Avec `gh pr list`, liste les PR ouvertes, leurs dépendances et leurs conflits, et propose un ordre de fusion. Ne fusionne
rien sans ma validation. »

**B10. Documents d'onboarding du prestataire**
« Ajoute un écran "Mes documents" pour un nouveau prestataire : liste des 3 documents avec leur état, invitation à les
téléverser, dépôt depuis l'appareil photo ou les fichiers (réutilise la logique de `medicalRecordAttachments.ts`),
message d'erreur précis par document. Demande à Chris le nom du bucket et de la table avant de coder. »

## À vérifier sur appareil avant de fermer les tâches dans Planii

A9 (canal du code, paiement en attente), B4 (écran noir au premier « Rejoindre »), B8 (les 5 retours du 19/11), A2 (parcours
de confirmation d'e-mail).

## Hors périmètre (P3 de Berton)

Non revérifiées après le pull : ordonnances et QR, consentement dossier médical, no-show et avoir patient, revenus réels,
changement de spécialité, recharges CDF, lien magique `visiodoc://auth/verify`, spécialités par pays, envoi des documents par
WhatsApp, POC agent WhatsApp, contrat `get-video-token`.
