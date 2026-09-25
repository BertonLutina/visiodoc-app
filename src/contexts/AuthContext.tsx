import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { User, UserRole } from '@/types';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { PROVIDER_NOT_VALIDATED } from '@/utils/authError';
import { COUNTRIES } from '@/config/countries';
import { currentPatient } from '@/data/mock';
import { currentProvider } from '@/data/mockProvider';
import * as biometrics from '@/services/biometrics';
import { logAuthEvent, type AuthEventMethod } from '@/services/auditLog';

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
  /** Code ISO du pays choisi, ex: 'CD' */
  countryCode?: string;
}

interface RegisterProviderInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  specialization: string;
  licenseNumber: string;
  /** Code ISO du pays, ex: 'CD' */
  countryCode?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  /** Vrai pendant la restauration de session au démarrage. */
  initializing: boolean;
  loginPatient: (email: string, password: string) => Promise<void>;
  loginProvider: (email: string, password: string) => Promise<void>;
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
  registerPatient: (input: RegisterPatientInput) => Promise<void>;
  registerProvider: (input: RegisterProviderInput) => Promise<void>;
  updateProfile: (
    partial: Partial<Pick<User, 'firstName' | 'lastName' | 'phone' | 'countryCode'>>,
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
};

function mapUserRow(row: any): User {
  const role = String(row.role || 'patient').toLowerCase() as UserRole;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    role: role === 'provider' ? 'provider' : role === 'admin' ? 'admin' : 'patient',
    phone: row.phone ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    // `users.country_id` est une FK → table `countries` ; le code pays vit dans countries.code
    countryCode: row.countries?.code ?? undefined,
    isActive: typeof row.is_active === 'boolean' ? row.is_active : undefined,
    doctorStatus: row.doctor_status ?? undefined,
  };
}

// Statuts médecin qui bloquent la connexion (pas encore validé par l'admin).
const PENDING_DOCTOR_STATUSES = [
  'PENDING_VALIDATION',
  'PENDING',
  'EN_ATTENTE',
  'EN_ATTENTE_VALIDATION',
  'REJECTED',
  'REFUSE',
  'SUSPENDED',
  'SUSPENDU',
];

/** Un médecin est autorisé si son compte est actif et son statut n'est pas en attente/refusé. */
export function isProviderValidated(u: Pick<User, 'isActive' | 'doctorStatus'>): boolean {
  if (u.isActive === false) return false;
  const s = (u.doctorStatus ?? '').toUpperCase();
  if (s && PENDING_DOCTOR_STATUSES.includes(s)) return false;
  return true;
}

async function loadProfile(userId: string): Promise<User | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('users')
    .select('*, countries ( code, currency_code, locale )')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return mapUserRow(data);
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

  // Restaure la session persistée (AsyncStorage) au démarrage → reste connecté
  // après un reload / crash, sans avoir à se reconnecter.
  useEffect(() => {
    if (!supabase) {
      setInitializing(false);
      return;
    }
    let active = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (active && data.session?.user) {
          const profile = await loadProfile(data.session.user.id);
          if (active && profile) {
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
      .finally(() => active && setInitializing(false));

    // Se déconnecte proprement si Supabase invalide la session (token expiré non renouvelable…)
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'SIGNED_OUT') {
        setUser(null);
        setPendingUser(null);
        setLocked(false);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Connexion active (mot de passe, OTP, OAuth, inscription) → jamais verrouillée,
  // et déclenche la proposition d'activer la biométrie.
  const signedIn = (profile: User, method?: AuthEventMethod) => {
    setUser(profile);
    setJustSignedIn(true);
    logAuthEvent('auth:login', { id: profile.id, role: profile.role, countryId: countryIdForCode(profile.countryCode) }, method);
  };

  const signIn = async (email: string, password: string, mockUser: User) => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const profile = data.user && (await loadProfile(data.user.id));
        if (!profile) {
          // Compte auth valide mais aucune ligne `users` correspondante (RLS, ligne
          // manquante…) : ne JAMAIS retomber sur mockUser ici — ce serait connecter
          // la personne sous une fausse identité qui passe toujours guardProvider.
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            /* ignore */
          }
          throw new Error('Profil introuvable pour ce compte. Contacte le support.');
        }
        await guardProvider(profile);
        signedIn(profile, 'password');
      } else {
        await new Promise((r) => setTimeout(r, 400));
        signedIn(mockUser, 'password');
      }
    } finally {
      setLoading(false);
    }
  };

  const loginPatient = (email: string, password: string) => signIn(email, password, currentPatient);
  const loginProvider = (email: string, password: string) => signIn(email, password, providerMockUser);

  // Bloque la connexion d'un médecin pas encore validé par l'admin (ferme la session).
  const guardProvider = async (profile: User) => {
    if (profile.role === 'provider' && !isProviderValidated(profile)) {
      try {
        await supabase?.auth.signOut({ scope: 'local' });
      } catch {
        /* ignore */
      }
      throw new Error(PROVIDER_NOT_VALIDATED);
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
    const profile = (authUser?.id && (await loadProfile(authUser.id))) || minimalUser(authUser, fallbackEmail);
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
      throw new Error('Backend non configuré.');
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
      if (!data?.url) throw new Error("La connexion avec ce fournisseur n'est pas disponible.");

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

  const registerPatient = async (input: RegisterPatientInput) => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase) {
        const email = input.email.trim().toLowerCase();
        // 1. Création du compte Auth (la session est ouverte directement)
        const { data, error } = await supabase.auth.signUp({
          email,
          password: input.password,
          options: { data: { first_name: input.firstName, last_name: input.lastName } },
        });
        if (error) throw error;
        const authUser = data.user;
        if (!authUser) throw new Error('Inscription impossible. Réessaie.');

        // 2. Création de la ligne profil dans public.users (aucun trigger côté DB).
        //    `public_id` est obligatoire et sans valeur par défaut → on le génère.
        const { error: insertError } = await supabase.from('users').insert({
          id: authUser.id,
          email,
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone || null,
          role: 'patient',
          country_id: countryIdForCode(input.countryCode),
          public_id: `VD-${authUser.id.slice(0, 8).toUpperCase()}`,
          is_active: true,
        });
        // 23505 = ligne déjà existante (ex: trigger qui l'aurait créée) → on ignore
        if (insertError && insertError.code !== '23505') throw insertError;

        const profile = (await loadProfile(authUser.id)) ?? {
          id: authUser.id,
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: 'patient' as const,
          phone: input.phone,
          countryCode: input.countryCode,
        };
        signedIn(profile, 'registration');
      } else {
        await new Promise((r) => setTimeout(r, 400));
        signedIn({ ...currentPatient, firstName: input.firstName, lastName: input.lastName, email: input.email }, 'registration');
      }
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
        const { data, error } = await supabase.functions.invoke('register-presta', {
          body: {
            email: input.email.trim().toLowerCase(),
            password: input.password,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            specialization: input.specialization,
            licenseNumber: input.licenseNumber,
            countryId: countryIdForCode(input.countryCode),
          },
        });
        if (error) {
          // FunctionsHttpError : le vrai message métier est dans la réponse (error.context)
          let msg = '';
          try {
            const body = await (error as any).context?.json?.();
            msg = body?.error ?? '';
          } catch {
            /* ignore */
          }
          throw new Error(msg || error.message);
        }
        if (data?.error) throw new Error(data.error);
        // Pas de connexion auto : le compte doit d'abord être validé par l'admin.
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (
    partial: Partial<Pick<User, 'firstName' | 'lastName' | 'phone' | 'countryCode'>>,
  ) => {
    setLoading(true);
    try {
      if (supabaseConfigured && supabase && user) {
        const patch: Record<string, unknown> = {};
        if (partial.firstName !== undefined) patch.first_name = partial.firstName;
        if (partial.lastName !== undefined) patch.last_name = partial.lastName;
        if (partial.phone !== undefined) patch.phone = partial.phone || null;
        if (partial.countryCode !== undefined) patch.country_id = countryIdForCode(partial.countryCode);
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
    // Un médecin dont le compte n'est plus validé est déconnecté (lève PROVIDER_NOT_VALIDATED).
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
    // `scope: 'local'` supprime la session persistée (AsyncStorage) sans dépendre du
    // serveur. Volontairement NON awaité : le SDK Supabase peut rester bloqué en
    // attente de son verrou interne (lock d'auth) si un getSession()/refreshSession()
    // est déjà en cours, ce qui gèlerait `logout()` et empêcherait tout appelant
    // (ex. `router.replace('/')` juste après) de jamais s'exécuter.
    supabase?.auth.signOut({ scope: 'local' }).catch(() => {
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
