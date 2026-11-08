/**
 * Verrou SYNCHRONE anti double-tap : l'état React (`useState`) ne change qu'au rendu suivant, deux appuis
 * rapprochés passent donc tous les deux. Ici le drapeau est posé avant le premier `await`.
 * `run` renvoie `undefined` sans rien exécuter si une tâche est déjà en cours.
 */
export function createBusyLock() {
  let busy = false;
  return {
    isBusy: () => busy,
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await task();
      } finally {
        busy = false;
      }
    },
  };
}
