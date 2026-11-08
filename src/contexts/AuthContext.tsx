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
  type Gender,
} from '@/services/registration';
import { getServiceTypeCatalog } from '@/services/specializationCatalog';
import { isSessionExpiry, onSessionExpired } from '@/services/sessionExpiry';
import { COUNTRIES } from '@/config/countries';
import { currentPatient } from '@/data/mock';
import { currentProvider } from '@/data/mockProvider';
import * as biometrics from '@/services/biometrics';
import { logAuthEvent, type AuthEventMethod } from '@/services/auditLog';
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

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  /** Vrai pendant la restauration de session au démarrage. */
  initializing: boolean;
  /** Renvoie l'utilisateur connecté (pour router selon `providerHomeHref`). */
  loginPatient: (email: string, password: string) => Promise<User>;
  loginProvider: (email: string, password: string) => Promise<User>;
  /** Connexion sans mot de passe — envoie un lien/code par email. */
  sendEmailOtp: (email: string) => Promise<void>;
  /** Vérifie le code ; renvoie l'utilisateur connecté (pour router selon le rôle). */
  verifyEmailOtp: (email: string, token: string) => Promise<User | null>;
  /** Connexion par téléphone — envoie un code par SMS. */
  sendPhoneOtp: (phone: string) => Promise<void>;
  verifyPhoneOtp: (phone: string, token: string) => Promise<User | null>;
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

/**
 * Nombre de `signOut` lancés PAR L'APPLICATION et pas encore terminés. Le SDK émet `SIGNED_OUT` aussi bien
 * pour une déconnexion volontaire que pour un rafraîchissement de jeton définitivement refusé (expiration) :
 * l'événement ne porte pas la cause. Tant que ce compteur est > 0, un `SIGNED_OUT` est le nôtre (le SDK
 * l'émet avant que la promesse de `signOut` ne se résolve) ; sinon c'est le SDK qui a purgé la session.
 */
let appInitiatedSignOuts = 0;

/** Ferme la session locale (`scope: 'local'`, sans dépendre du serveur) en marquant la déconnexion comme volontaire. */
function localSignOut(): Promise<unknown> {
  if (!supabase) return Promise.resolve();
  appInitiatedSignOuts += 1;
  return supabase.auth.signOut({ scope: 'local' }).finally(() => {
    appInitiatedSignOuts -= 1;
  });
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
  // Le message d'expiration ne s'affiche qu'une fois par expiration (rétabli à la prochaine connexion).
  const expiryShownRef = useRef(false);

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
      setUser(null);
      setPendingUser(null);
      setLocked(false);
      // Différé : le SDK interdit d'appeler ses méthodes async depuis son propre callback d'événement.
      setTimeout(() => {
        localSignOut().catch(() => {
          /* ignore : l'état local est déjà nettoyé */
        });
      }, 0);
      if (!expiryShownRef.current) {
        expiryShownRef.current = true;
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
        const voluntary = appInitiatedSignOuts > 0;
        const hadSession = restoringRef.current || !!userRef.current || !!pendingUserRef.current;
        if (!voluntary && hadSession) {
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
    expiryShownRef.current = false;
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

  const finishOtp = async (authUser: any, fallbackEmail?: string, method?: AuthEventMethod): Promise<User> => {
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
    signedIn(profile, method);
    return profile;
  };

  /* ---------- Connexion sans mot de passe : email ---------- */
  const sendEmailOtp = async (email: string) => {
    if (!supabaseConfigured || !supabase) {
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    // shouldCreateUser: false → ne connecte que des comptes existants (pas d'orphelin sans profil)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  };

  const verifyEmailOtp = async (email: string, token: string): Promise<User | null> => {
    setLoading(true);
    try {
      if (!supabaseConfigured || !supabase) {
        const u = { ...currentPatient, email: email.trim().toLowerCase() };
        signedIn(u, 'email_otp');
        return u;
      }
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: 'email',
      });
      if (error) throw error;
      return await finishOtp(data.user, email, 'email_otp');
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

  const verifyPhoneOtp = async (phone: string, token: string): Promise<User | null> => {
    setLoading(true);
    try {
      if (!supabaseConfigured || !supabase) {
        const u = { ...currentPatient, phone };
        signedIn(u, 'phone_otp');
        return u;
      }
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: token.trim(),
        type: 'sms',
      });
      if (error) throw error;
      return await finishOtp(data.user, undefined, 'phone_otp');
    } finally {
      setLoading(false);
    }
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
    // pendingUser vient d'une restauration déjà filtrée ; on re-vérifie le rôle avant d'ouvrir l'espace.
    if (!mobileRole(profile.role)) {
      dropForbiddenSession();
      throw roleNotAllowedError();
    }
    // Un médecin dont le statut ne permet plus l'accès est déconnecté (lève un refus par statut).
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
      sendEmailOtp,
      verifyEmailOtp,
      sendPhoneOtp,
      verifyPhoneOtp,
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
