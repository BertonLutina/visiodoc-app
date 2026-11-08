/**
 * Distingue une déconnexion VOLONTAIRE (lancée par l'application) d'une expiration de session.
 *
 * Le SDK Supabase émet `SIGNED_OUT` dans les deux cas et l'événement ne porte pas la cause. L'app compte
 * donc ses propres `signOut` en cours : le SDK émet `SIGNED_OUT` avant que la promesse de `signOut` ne se
 * résolve, donc tant que le compteur est > 0 l'événement est le nôtre. Sinon le SDK a purgé la session
 * (rafraîchissement refusé) → expiration, message affiché une seule fois jusqu'à la prochaine connexion.
 * Limite connue : une expiration survenant pendant qu'un `signOut` de l'app est encore en cours est
 * prise pour volontaire (pas de message).
 */
export type SignedOutKind = 'voluntary' | 'expired' | 'ignored';

export function createSessionExpiryTracker() {
  let inFlight = 0;
  let noticeShown = false;
  let cleanupClaimed = false;

  return {
    /** À appeler avant un `signOut` de l'app ; renvoie la fonction à appeler (une seule fois effective) à sa fin. */
    beginAppSignOut(): () => void {
      inFlight += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        inFlight -= 1;
      };
    },

    /** Vrai tant qu'un `signOut` de l'app est en cours. */
    isAppInitiated(): boolean {
      return inFlight > 0;
    },

    /**
     * Classe un `SIGNED_OUT` reçu. `hadSession` : une session existait (utilisateur connecté, verrou
     * biométrique en attente ou restauration en cours). `notify` vrai = afficher le message maintenant.
     */
    onSignedOut(hadSession: boolean): { kind: SignedOutKind; notify: boolean } {
      if (inFlight > 0) return { kind: 'voluntary', notify: false };
      if (!hadSession) return { kind: 'ignored', notify: false };
      return { kind: 'expired', notify: this.claimExpiryNotice() };
    },

    /**
     * Vrai une seule fois par expiration (restauration, `SIGNED_OUT`, signalement d'un service).
     * `hadSession` faux (visiteur qui n'a jamais eu de session, ex. lien profond) : jamais de message, et le
     * message reste disponible pour une vraie expiration ultérieure.
     */
    claimExpiryNotice(hadSession = true): boolean {
      if (!hadSession) return false;
      if (noticeShown) return false;
      noticeShown = true;
      return true;
    },

    /**
     * Vrai une seule fois par expiration pour le nettoyage (état local + `signOut` local) : plusieurs
     * chargements qui échouent ensemble signalent la même expiration, un seul doit agir.
     */
    claimCleanup(): boolean {
      if (cleanupClaimed) return false;
      cleanupClaimed = true;
      return true;
    },

    /** Nouvelle connexion : le prochain événement d'expiration affichera de nouveau le message. */
    resetNotice(): void {
      noticeShown = false;
      cleanupClaimed = false;
    },
  };
}
