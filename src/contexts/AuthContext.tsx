import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { User } from '@/types';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import {
  edgeFunctionError,
  providerRefusalError,
  providerRefusalMessage,
  roleNotAllowedError,
  roleNotAllowedMessage,
} from '@/utils/authError';
import { mobileRole, providerRefusalReason, type MobileRole } from '@/services/accessPolicy';
import {
  buildRegisterPrestaBody,
  registerPatientAccount,
  resolveSpecialty,
  requireLoginCredentialsStep,
  submitLoginCredentials,
  LoginCredentialsError,
  type LoginCredentialsOutcome,
  type Gender,
} from '@/services/registration';
import {
  clearCredentialsPending,
  pendingCredentialsUserIds,
  shouldDropOnRestore,
} from '@/services/loginCredentialsFlag';
import { getServiceTypeCatalog } from '@/services/specializationCatalog';
import { completePhoneIdentity, type PhoneIdentityInput } from '@/services/patientIdentity';
import { isSessionExpiry, onSessionExpired, reportSessionExpiry } from '@/services/sessionExpiry';
import { createSessionExpiryTracker } from '@/services/sessionExpiryTracker';
import { COUNTRIES } from '@/config/countries';
import { currentPatient } from '@/data/mock';
import { currentProvider } from '@/data/mockProvider';
import * as biometrics from '@/services/biometrics';
import { logAuthEvent, type AuthEventMethod } from '@/services/auditLog';
import { requestMagicLink, verifyMagicLinkToken } from '@/services/magicLink';
import { translate } from '@/i18n/core';

// Termine proprement une session OAuth ouverte dans le navigateur système.
WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'azure';

// La table Supabase `countries` ne contient pour l'instant que CD et NE.
// On résout l'UUID country_id depuis la config ; repli sur la RDC (marché de lancement).
const CD_COUNTRY_ID = COUNTRIES.CD.id;
const countryIdForCode = (code?: string): string | undefined =>
  (code && COUNTRIES[code]?.id) || CD_COUNTRY_ID;

/**
 * Auth unifiée patient + médecin.
 * - Si Supabase est configuré (.env) : auth réelle via supabase.auth + Edge Functions.
 * - Sinon : mode mock pour parcourir l'UI dans Expo Go sans backend.
 */
interface RegisterPatientInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  /** `users.gender` : uniquement 'male' ou 'female'. */
  gender: Gender;
  /** Code ISO du pays choisi, ex: 'CD' */
  countryCode?: string;
  /** `AAAA-MM-JJ`, 18 ans révolus (MOB-1211-1). */
  dateOfBirth: string;
  city?: string;
  commune?: string;
}

interface RegisterProviderInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  /** `users.gender` : uniquement 'male' ou 'female'. */
  gender: Gender;
  /** Libellé de la spécialité choisie (résolu en serviceTypeId, sinon proposé). */
  specialization: string;
  licenseNumber: string;
  city: string;
  /** Code ISO du pays, ex: 'CD' */
  countryCode?: string;
}

/** Résultat de la validation du code téléphone : `needsLoginCredentials` = e-mail + mot de passe à définir avant d'entrer. */
export interface PhoneOtpResult {
  user: User | null;
  needsLoginCredentials: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  /** Vrai pendant la restauration de session au démarrage. */
  initializing: boolean;
  /** Renvoie l'utilisateur connecté (pour router selon `providerHomeHref`). */
  loginPatient: (email: string, password: string) => Promise<User>;
  loginProvider: (email: string, password: string) => Promise<User>;
  /** Lien magique patient (comme le web) : envoie l'e-mail contenant `…/auth/verify?token=…`. */
  sendMagicLink: (email: string) => Promise<void>;
  /** Échange le jeton du lien contre une session ; renvoie l'utilisateur connecté (gardes de rôle et de statut incluses). */
  verifyMagicLink: (token: string) => Promise<User>;
  /** Connexion par téléphone — envoie un code par SMS. */
  sendPhoneOtp: (phone: string) => Promise<void>;
  /**
   * Valide le code. Un compte téléphone sans e-mail n'est PAS ouvert : `needsLoginCredentials` vaut
   * vrai et l'écran doit appeler `saveLoginCredentials` (étape obligatoire) ou `cancelLoginCredentials`.
   */
  verifyPhoneOtp: (phone: string, token: string) => Promise<PhoneOtpResult>;
  /** `set-login-credentials` après l'OTP, puis ouverture de la session (gardes de rôle et de statut incluses). */
  saveLoginCredentials: (
    email: string,
    newPassword: string,
    confirmPassword: string,
  ) => Promise<{ user: User; outcome: LoginCredentialsOutcome }>;
  /** Abandon de l'étape e-mail + mot de passe : la session créée par l'OTP est fermée. */
  cancelLoginCredentials: () => void;
  /**
   * Identité d'un patient inscrit par téléphone (nom, genre, date de naissance 18 ans, ville, commune).
   * `userId` = compte issu du code (la session existe déjà, même si l'app n'est pas encore ouverte).
   */
  completePatientIdentity: (userId: string, input: PhoneIdentityInput) => Promise<void>;
  /** Connexion sociale (Google, Microsoft/Outlook…). Renvoie l'utilisateur connecté. */
  signInWithProvider: (provider: OAuthProvider) => Promise<User | null>;
  /** Envoie un email de réinitialisation de mot de passe. */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Inscription patient : `requiresEmailConfirmation` vrai = e-mail à confirmer, pas de session ouverte. */
  registerPatient: (input: RegisterPatientInput) => Promise<{ requiresEmailConfirmation: boolean }>;
  registerProvider: (input: RegisterProviderInput) => Promise<void>;
  updateProfile: (
    partial: Partial<Pick<User, 'firstName' | 'lastName' | 'phone' | 'countryCode' | 'preferredLanguage' | 'avatarUrl'>>,
  ) => Promise<void>;
  /** Vrai au lancement si la session restaurée attend la biométrie. */
  locked: boolean;
  /** Prénom du compte verrouillé (écran de verrou). */
  lockedFirstName: string;
  /** Demande la biométrie et ouvre la session en attente. */
  unlock: () => Promise<boolean>;
  /** Biométrie utilisable sur ce téléphone (et backend configuré). */
  biometricAvailable: boolean;
  /** « Face ID », « Touch ID », « Empreinte digitale »… */
  biometricLabel: string;
  /** Préférence du compte connecté. */
  biometricEnabled: boolean;
  /** Active (après vérification biométrique) ou désactive. Renvoie vrai si changé. */
  setBiometricEnabled: (enabled: boolean) => Promise<boolean>;
  /** Vrai juste après une connexion active (pas une restauration de session). */
  justSignedIn: boolean;
  consumeJustSignedIn: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const providerMockUser: User = {
  id: currentProvider.id,
  email: currentProvider.email,
  firstName: currentProvider.firstName,
  lastName: currentProvider.lastName,
  role: 'provider',
  phone: currentProvider.phone,
  countryCode: 'CD',
  // Mode mock : un prestataire entièrement validé (même vocabulaire que `users.doctor_status`).
  isActive: true,
  doctorStatus: 'VALIDE_ABO_ACTIF',
};

function mapUserRow(row: any, role: MobileRole): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    role,
    phone: row.phone ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    // `users.country_id` est une FK → table `countries` ; le code pays vit dans countries.code
    countryCode: row.countries?.code ?? undefined,
    preferredLanguage: row.preferred_language ?? undefined,
    isActive: typeof row.is_active === 'boolean' ? row.is_active : undefined,
    doctorStatus: row.doctor_status ?? undefined,
  };
}

/**
 * Résultat de la lecture de `users` pour un compte authentifié. On distingue « aucune ligne »
 * (`missing`, p. ex. nouvel utilisateur OTP sans profil → repli `minimalUser`) d'une ligne dont le
 * rôle n'est pas mobile (`forbidden` : admin, validateur… → refus, jamais converti en patient).
 * `error` = lecture impossible (réseau, RLS) : on ne sait pas quel est le rôle, donc jamais de repli patient.
 */
type ProfileResult =
  | { status: 'ok'; user: User }
  | { status: 'missing' }
  | { status: 'forbidden' }
  | { status: 'error' };

async function loadProfile(userId: string): Promise<ProfileResult> {
  if (!supabase) return { status: 'missing' };
  const { data, error } = await supabase
    .from('users')
    .select('*, countries ( code, currency_code, locale )')
    .eq('id', userId)
    .single();
  // PGRST116 : `.single()` n'a trouvé aucune ligne → le compte n'a vraiment pas de profil.
  if (error && error.code !== 'PGRST116') return { status: 'error' };
  if (error || !data) return { status: 'missing' };
  const role = mobileRole(data.role);
  if (!role) return { status: 'forbidden' };
  return { status: 'ok', user: mapUserRow(data, role) };
}

/** Distingue `SIGNED_OUT` volontaire / expiration et dédoublonne le message (cf. sessionExpiryTracker). */
const expiryTracker = createSessionExpiryTracker();

/** Ferme la session locale (`scope: 'local'`, sans dépendre du serveur) en marquant la déconnexion comme volontaire. */
function localSignOut(): Promise<unknown> {
  if (!supabase) return Promise.resolve();
  const end = expiryTracker.beginAppSignOut();
  return supabase.auth.signOut({ scope: 'local' }).finally(end);
}

/**
 * Ferme la session locale d'un compte au rôle non mobile. `signOut` n'est volontairement PAS
 * awaité (même raison que dans `logout()` : le verrou interne du SDK peut bloquer l'appelant).
 */
function dropForbiddenSession() {
  localSignOut().catch(() => {
    /* ignore : aucun état utilisateur n'a été posé */
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  // Vrai tant que la session persistée n'a pas été restaurée au démarrage.
  const [initializing, setInitializing] = useState<boolean>(!!supabase);

  // Déverrouillage biométrique au lancement : le profil restauré attend dans pendingUser.
  const [locked, setLocked] = useState(false);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Biométrie');
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);

  // Lecture de l'état courant depuis le listener d'auth (monté une seule fois, donc sans fermeture à jour).
  const userRef = useRef<User | null>(null);
  const pendingUserRef = useRef<User | null>(null);
  userRef.current = user;
  pendingUserRef.current = pendingUser;
  // Vrai pendant la restauration de session au démarrage (session persistée en cours de rafraîchissement).
  const restoringRef = useRef(!!supabase);

  useEffect(() => {
    if (!supabaseConfigured) return;
    biometrics.isAvailable().then(setBiometricAvailable);
    biometrics.getLabel().then(setBiometricLabel);
  }, []);

  // Préférence du compte connecté.
  useEffect(() => {
    if (!user) {
      setBiometricEnabledState(false);
      return;
    }
    let active = true;
    biometrics.isEnabled(user.id).then((v) => active && setBiometricEnabledState(v));
    return () => {
      active = false;
    };
  }, [user?.id]);

  // Restaure la session persistée (trousseau) au démarrage → reste connecté
  // après un reload / crash, sans avoir à se reconnecter.
  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    let active = true;

    // Session expirée (rafraîchissement impossible) : état local vidé comme pour SIGNED_OUT, session locale
    // fermée, retour à l'écran de connexion (les gardes d'écran redirigent dès que `user` est nul) et
    // message affiché une seule fois. `signOut` n'est pas awaité (verrou interne du SDK, cf. `logout`).
    const handleSessionExpired = () => {
      if (!active) return;
      // Plusieurs chargements en échec simultanés signalent la même expiration : un seul nettoie et notifie.
      if (!expiryTracker.claimCleanup()) return;
      // Message seulement si une session existait (utilisateur, verrou biométrique en attente ou
      // restauration d'une session persistée) : jamais pour un visiteur (ex. lien profond vers /call/x).
      const hadSession = restoringRef.current || !!userRef.current || !!pendingUserRef.current;
      setUser(null);
      setPendingUser(null);
      setLocked(false);
      // Différé : le SDK interdit d'appeler ses méthodes async depuis son propre callback d'événement.
      setTimeout(() => {
        localSignOut().catch(() => {
          /* ignore : l'état local est déjà nettoyé */
        });
      }, 0);
      if (expiryTracker.claimExpiryNotice(hadSession)) {
        Alert.alert(translate('Ta session a expiré, reconnecte-toi.'));
      }
    };
    // Cas « JWT expired » remonté par un appel de données (cf. `reportSessionExpiry`).
    const offExpiryReports = onSessionExpired(handleSessionExpired);

    supabase.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (active && isSessionExpiry(error)) {
          // Jeton de rafraîchissement refusé au démarrage : jamais de restauration, message unique.
          handleSessionExpired();
        } else if (
          active &&
          data.session?.user &&
          shouldDropOnRestore(data.session.user.id, await pendingCredentialsUserIds())
        ) {
          // Inscription par téléphone interrompue avant l'e-mail + mot de passe (app fermée sur l'étape) :
          // jamais restaurée, session fermée sans message ; elle refait le code puis l'étape.
          await clearCredentialsPending(data.session.user.id);
          dropForbiddenSession();
        } else if (active && data.session?.user) {
          const result = await loadProfile(data.session.user.id);
          const refusal = result.status === 'ok' ? providerRefusalReason(result.user) : null;
          if (active && result.status === 'forbidden') {
            // Un compte admin connecté ailleurs n'est jamais restauré : session fermée, alerte unique.
            dropForbiddenSession();
            Alert.alert(roleNotAllowedMessage());
          } else if (active && refusal) {
            // Prestataire en attente, rejeté, incomplet ou suspendu : jamais restauré. Session
            // fermée, alerte unique (même schéma que le rôle refusé), pas de boucle au redémarrage.
            dropForbiddenSession();
            Alert.alert(translate('Connexion impossible'), providerRefusalMessage(refusal));
          } else if (active && result.status === 'ok') {
            const profile = result.user;
            if (await biometrics.shouldLockAtLaunch(profile.id)) {
              // Le profil reste en attente : aucun écran ne se charge avant la biométrie.
              setPendingUser(profile);
              setLocked(true);
            } else {
              setUser(profile);
            }
          }
        }
      })
      .finally(() => {
        restoringRef.current = false;
        if (active) setInitializing(false);
      });

    // Se déconnecte proprement si Supabase invalide la session (token expiré non renouvelable…)
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'SIGNED_OUT') {
        // Déconnexion lancée par l'app (logout, refus de rôle ou de statut…) : pas de message.
        const hadSession = restoringRef.current || !!userRef.current || !!pendingUserRef.current;
        if (expiryTracker.onSignedOut(hadSession).kind === 'expired') {
          // Le SDK a purgé la session après un rafraîchissement refusé : on explique pourquoi.
          handleSessionExpired();
          return;
        }
        setUser(null);
        setPendingUser(null);
        setLocked(false);
      }
    });
    return () => {
      active = false;
      offExpiryReports();
      sub.subscription.unsubscribe();
    };
  }, []);

  // Connexion active (mot de passe, OTP, OAuth, inscription) → jamais verrouillée,
  // et déclenche la proposition d'activer la biométrie.
  const signedIn = (profile: User, method?: AuthEventMethod) => {
    expiryTracker.resetNotice();
    setUser(profile);
    setJustSignedIn(true);
    logAuthEvent('auth:login', { id: profile.id, role: profile.role, countryId: countryIdForCode(profile.countryCode) }, method);
  };

  const signIn = async (email: string, password: string, mockUser: User): Promise<User> => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const result = data.user ? await loadProfile(data.user.id) : ({ status: 'missing' } as ProfileResult);
        if (result.status === 'forbidden') {
          dropForbiddenSession();
          throw roleNotAllowedError();
        }
        if (result.status !== 'ok') {
          // Compte auth valide mais aucune ligne `users` correspondante (RLS, ligne
          // manquante…) : ne JAMAIS retomber sur mockUser ici — ce serait connecter
          // la personne sous une fausse identité qui passe toujours guardProvider.
          try {
            await localSignOut();
          } catch {
            /* ignore */
          }
          throw new Error(translate('Profil introuvable pour ce compte. Contacte le support.'));
        }
        const profile = result.user;
        await guardProvider(profile);
        signedIn(profile, 'password');
        return profile;
      }
      await new Promise((r) => setTimeout(r, 400));
      signedIn(mockUser, 'password');
      return mockUser;
    } finally {
      setLoading(false);
    }
  };

  const loginPatient = (email: string, password: string) => signIn(email, password, currentPatient);
  const loginProvider = (email: string, password: string) => signIn(email, password, providerMockUser);

  // Garde prestataire (`providerGate`) : `full` et `subscribe` restent connectés (le second est
  // routé vers l'abonnement) ; en attente, rejeté, incomplet ou suspendu → session fermée + refus
  // précis (message distinct par statut sur l'écran de connexion).
  const guardProvider = async (profile: User) => {
    const refusal = providerRefusalReason(profile);
    if (refusal) {
      try {
        await localSignOut();
      } catch {
        /* ignore */
      }
      throw providerRefusalError(refusal);
    }
  };

  // Construit un utilisateur minimal quand la ligne profil `users` n'existe pas encore.
  const minimalUser = (u: any, fallbackEmail?: string): User => ({
    id: u?.id ?? 'otp-user',
    email: u?.email ?? fallbackEmail ?? '',
    firstName: u?.user_metadata?.first_name ?? '',
    lastName: u?.user_metadata?.last_name ?? '',
    role: 'patient',
    phone: u?.phone ?? undefined,
  });

  // Profil du compte qui vient de s'authentifier par code, après les gardes de rôle et de statut.
  const resolveOtpProfile = async (authUser: any, fallbackEmail?: string): Promise<User> => {
    const result = authUser?.id ? await loadProfile(authUser.id) : ({ status: 'missing' } as ProfileResult);
    if (result.status === 'forbidden') {
      dropForbiddenSession();
      throw roleNotAllowedError();
    }
    if (result.status === 'error') {
      // Rôle inconnu (lecture impossible) : jamais de repli patient, on ferme la session.
      dropForbiddenSession();
      throw new Error(translate('Profil introuvable pour ce compte. Contacte le support.'));
    }
    // Aucune ligne `users` (role absent) : profil minimal patient. Une ligne existante au rôle non
    // mobile a déjà été refusée ci-dessus.
    const profile = result.status === 'ok' ? result.user : minimalUser(authUser, fallbackEmail);
    await guardProvider(profile);
    return profile;
  };

  const finishOtp = async (authUser: any, fallbackEmail?: string, method?: AuthEventMethod): Promise<User> => {
    const profile = await resolveOtpProfile(authUser, fallbackEmail);
    signedIn(profile, method);
    return profile;
  };

  /* ---------- Lien magique par e-mail (patients, même flux que le web) ---------- */
  const sendMagicLink = async (email: string) => {
    if (!supabaseConfigured || !supabase) {
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    await requestMagicLink(email);
  };

  const verifyMagicLink = async (token: string): Promise<User> => {
    setLoading(true);
    try {
      if (!supabaseConfigured || !supabase) {
        signedIn(currentPatient, 'magic_link');
        return currentPatient;
      }
      const session = await verifyMagicLinkToken(token);
      const { data, error } = await supabase.auth.setSession(session);
      if (error) throw error;
      return await finishOtp(data.user ?? data.session?.user, undefined, 'magic_link');
    } finally {
      setLoading(false);
    }
  };

  /* ---------- Connexion par téléphone (SMS) ---------- */
  const sendPhoneOtp = async (phone: string) => {
    if (!supabaseConfigured || !supabase) {
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
  };

  // Id du compte entre la validation du code et l'enregistrement de l'e-mail + mot de passe (aucun mot de passe ici).
  const awaitingCredentialsRef = useRef<string | null>(null);

  const verifyPhoneOtp = async (phone: string, token: string): Promise<PhoneOtpResult> => {
    setLoading(true);
    try {
      if (!supabaseConfigured || !supabase) {
        const u = { ...currentPatient, phone };
        signedIn(u, 'phone_otp');
        return { user: u, needsLoginCredentials: false };
      }
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: token.trim(),
        type: 'sms',
      });
      if (error) throw error;
      // Étape demandée juste après un code : compte sans e-mail de connexion (règle `hasNoLoginEmail` du
      // backend) et étape pas déjà envoyée. Le marqueur `credentialsPending:<userId>` est posé ICI, avant de
      // rendre la main (la session est déjà persistée) ; une restauration le lira pour fermer la session.
      if (await requireLoginCredentialsStep(data.user)) {
        // Rôle et statut vérifiés d'abord (refus = session fermée), mais l'app ne s'ouvre pas encore :
        // l'étape e-mail + mot de passe est obligatoire pour un compte créé par téléphone.
        const profile = await resolveOtpProfile(data.user);
        awaitingCredentialsRef.current = data.user?.id ?? null;
        return { user: profile, needsLoginCredentials: true };
      }
      return { user: await finishOtp(data.user, undefined, 'phone_otp'), needsLoginCredentials: false };
    } finally {
      setLoading(false);
    }
  };

  const saveLoginCredentials = async (
    email: string,
    newPassword: string,
    confirmPassword: string,
  ): Promise<{ user: User; outcome: LoginCredentialsOutcome }> => {
    const userId = awaitingCredentialsRef.current;
    if (!supabaseConfigured || !supabase || !userId) {
      throw new Error(translate('Une erreur est survenue. Réessaie.'));
    }
    setLoading(true);
    try {
      let outcome: LoginCredentialsOutcome;
      try {
        // Pose aussi le drapeau `credentialsSubmitted:<userId>` (succès, ou e-mail de connexion déjà présent).
        outcome = await submitLoginCredentials(userId, email, newPassword, confirmPassword);
      } catch (e) {
        if (e instanceof LoginCredentialsError && e.kind === 'session_expired') {
          // Session de l'OTP expirée : voie Task 6 (purge + message unique), l'étape est abandonnée.
          awaitingCredentialsRef.current = null;
          await clearCredentialsPending(userId);
          reportSessionExpiry(e);
        }
        throw e;
      }
      awaitingCredentialsRef.current = null;
      // Rafraîchit la session (mot de passe fixé ; l'e-mail reste en attente de confirmation par lien).
      let authUser: any = null;
      try {
        const { data } = await supabase.auth.refreshSession();
        authUser = data.user ?? data.session?.user ?? null;
      } catch {
        /* le compte est à jour côté serveur : on retombe sur la session en cours */
      }
      if (!authUser) authUser = (await supabase.auth.getSession()).data.session?.user ?? null;
      const user = await finishOtp(authUser, email.trim().toLowerCase(), 'phone_otp');
      return { user, outcome };
    } finally {
      setLoading(false);
    }
  };

  const cancelLoginCredentials = () => {
    const userId = awaitingCredentialsRef.current;
    if (!userId) return;
    awaitingCredentialsRef.current = null;
    clearCredentialsPending(userId).catch(() => {
      /* ignore */
    });
    localSignOut().catch(() => {
      /* ignore : aucun état utilisateur n'a été posé */
    });
  };

  /* ---------- Connexion sociale (OAuth) ---------- */
  const signInWithProvider = async (provider: OAuthProvider): Promise<User | null> => {
    if (!supabaseConfigured || !supabase) {
      throw new Error(translate('Backend non configuré.'));
    }
    setLoading(true);
    const oauthMethod: AuthEventMethod = provider === 'google' ? 'oauth_google' : 'oauth_azure';
    try {
      const redirectTo = Linking.createURL('/');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(translate("La connexion avec ce fournisseur n'est pas disponible."));

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) return null; // annulé par l'utilisateur

      // Flux PKCE : ?code=… → échange contre une session
      const parsed = Linking.parse(result.url);
      const code = parsed.queryParams?.code as string | undefined;
      if (code) {
        const { data: sess, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exErr) throw exErr;
        return await finishOtp(sess.user, undefined, oauthMethod);
      }
      // Flux implicite : #access_token=…&refresh_token=…
      const hash = result.url.split('#')[1];
      if (hash) {
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');
        if (access_token && refresh_token) {
          const { data: sess, error: sErr } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (sErr) throw sErr;
          return await finishOtp(sess.user, undefined, oauthMethod);
        }
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  const completePatientIdentity = async (userId: string, input: PhoneIdentityInput) => {
    await completePhoneIdentity(userId, input);
    setUser((u) =>
      u && u.id === userId ? { ...u, firstName: input.firstName.trim(), lastName: input.lastName.trim() } : u,
    );
  };

  const sendPasswordReset = async (email: string) => {
    if (!supabaseConfigured || !supabase) {
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: Linking.createURL('/'),
    });
    if (error) throw error;
  };

  const registerPatient = async (input: RegisterPatientInput): Promise<{ requiresEmailConfirmation: boolean }> => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase) {
        // Edge Function register-patient : le compte est créé côté serveur et l'e-mail de
        // confirmation est envoyé. Pas de connexion automatique : l'adresse doit d'abord être confirmée.
        return await registerPatientAccount(input);
      }
      // Mode mock (aucun Supabase configuré) : on parcourt l'UI comme avant, patient connecté.
      await new Promise((r) => setTimeout(r, 400));
      signedIn({ ...currentPatient, firstName: input.firstName, lastName: input.lastName, email: input.email }, 'registration');
      return { requiresEmailConfirmation: false };
    } finally {
      setLoading(false);
    }
  };

  const registerProvider = async (input: RegisterProviderInput) => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase) {
        // Edge Function register-presta → crée le compte prestataire.
        // Champs obligatoires côté fonction : phone + countryId (UUID du pays).
        // `buildRegisterPrestaBody` lève avant tout appel réseau si le genre n'est pas male/female.
        const { serviceTypeId, proposedSpecialtyLabel } = resolveSpecialty(
          input.specialization,
          await getServiceTypeCatalog(),
        );
        const body = buildRegisterPrestaBody({
          email: input.email,
          password: input.password,
          firstName: input.firstName,
          lastName: input.lastName,
          gender: input.gender,
          phone: input.phone,
          countryCode: input.countryCode,
          serviceTypeId,
          proposedSpecialtyLabel,
          countryId: countryIdForCode(input.countryCode),
          city: input.city,
          licenseNumber: input.licenseNumber,
        });
        const { data, error } = await supabase.functions.invoke('register-presta', { body });
        if (error) {
          // FunctionsHttpError : le vrai message métier est dans la réponse (error.context).
          // On conserve `error_code` / `reasons` (ex. 422 weak_password + pwned) sur l'erreur levée.
          let resBody: any = null;
          try {
            resBody = await (error as any).context?.json?.();
          } catch {
            /* ignore */
          }
          throw edgeFunctionError(resBody, error.message);
        }
        if (data?.error) throw edgeFunctionError(data);
        // Pas de connexion auto : le compte doit d'abord être validé par l'admin.
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (
    partial: Partial<Pick<User, 'firstName' | 'lastName' | 'phone' | 'countryCode' | 'preferredLanguage' | 'avatarUrl'>>,
  ) => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase && user) {
        const patch: Record<string, unknown> = {};
        if (partial.firstName !== undefined) patch.first_name = partial.firstName;
        if (partial.lastName !== undefined) patch.last_name = partial.lastName;
        if (partial.phone !== undefined) patch.phone = partial.phone || null;
        if (partial.countryCode !== undefined) patch.country_id = countryIdForCode(partial.countryCode);
        if (partial.preferredLanguage !== undefined) patch.preferred_language = partial.preferredLanguage || null;
        if (partial.avatarUrl !== undefined) patch.avatar_url = partial.avatarUrl || null;
        if (Object.keys(patch).length) {
          const { error } = await supabase.from('users').update(patch).eq('id', user.id);
          if (error) throw error;
        }
      }
      setUser((u) => (u ? { ...u, ...partial } : u));
    } finally {
      setLoading(false);
    }
  };

  /* ---------- Biométrie ---------- */
  const unlock = async (): Promise<boolean> => {
    if (!pendingUser) return false;
    const ok = await biometrics.authenticate('Déverrouiller VisioDoc');
    if (!ok) return false;
    const profile = pendingUser;
    setPendingUser(null);
    setLocked(false);
    // pendingUser vient d'une restauration déjà filtrée (profil lu au démarrage, NON relu ici) : on
    // re-contrôle seulement le rôle et la garde prestataire sur ce profil mémorisé. Un `doctor_status`
    // modifié côté serveur depuis le démarrage n'est pas revu avant la prochaine connexion ou restauration.
    if (!mobileRole(profile.role)) {
      dropForbiddenSession();
      throw roleNotAllowedError();
    }
    // Un médecin dont le statut mémorisé ne permet pas l'accès est déconnecté (lève un refus par statut).
    await guardProvider(profile);
    setUser(profile);
    logAuthEvent(
      'auth:biometric_unlock',
      { id: profile.id, role: profile.role, countryId: countryIdForCode(profile.countryCode) },
      'biometric',
    );
    return true;
  };

  const setBiometricEnabled = async (enabled: boolean): Promise<boolean> => {
    if (!user) return false;
    if (enabled) {
      if (!(await biometrics.isAvailable())) return false;
      const ok = await biometrics.authenticate(`Activer ${biometricLabel}`);
      if (!ok) return false;
    }
    await biometrics.setEnabled(user.id, enabled);
    setBiometricEnabledState(enabled);
    if (enabled) {
      logAuthEvent(
        'auth:biometric_enroll',
        { id: user.id, role: user.role, countryId: countryIdForCode(user.countryCode) },
        'biometric',
      );
    }
    return true;
  };

  const consumeJustSignedIn = () => setJustSignedIn(false);

  const logout = async () => {
    if (user) {
      logAuthEvent('auth:logout', { id: user.id, role: user.role, countryId: countryIdForCode(user.countryCode) });
    }
    // On vide l'état local D'ABORD → la déconnexion est instantanée et fiable,
    // même si l'appel réseau à Supabase échoue (session expirée, hors-ligne…).
    setUser(null);
    setPendingUser(null);
    setLocked(false);
    setJustSignedIn(false);
    // `scope: 'local'` supprime la session persistée (trousseau) sans dépendre du
    // serveur. Volontairement NON awaité : le SDK Supabase peut rester bloqué en
    // attente de son verrou interne (lock d'auth) si un getSession()/refreshSession()
    // est déjà en cours, ce qui gèlerait `logout()` et empêcherait tout appelant
    // (ex. `router.replace('/')` juste après) de jamais s'exécuter.
    localSignOut().catch(() => {
      /* ignore : l'état local est déjà nettoyé */
    });
  };

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      loading,
      // Tant que le verrou est actif, on considère la session comme non restaurée.
      initializing: initializing || locked,
      loginPatient,
      loginProvider,
      sendMagicLink,
      verifyMagicLink,
      sendPhoneOtp,
      verifyPhoneOtp,
      saveLoginCredentials,
      cancelLoginCredentials,
      completePatientIdentity,
      signInWithProvider,
      sendPasswordReset,
      registerPatient,
      registerProvider,
      updateProfile,
      locked,
      lockedFirstName: pendingUser?.firstName ?? '',
      unlock,
      biometricAvailable,
      biometricLabel,
      biometricEnabled,
      setBiometricEnabled,
      justSignedIn,
      consumeJustSignedIn,
      logout,
    }),
    [user, loading, initializing, locked, pendingUser, biometricAvailable, biometricLabel, biometricEnabled, justSignedIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
