// Dossier médical par personne (MOB-1311-2 §2) : « Moi » ou un enfant, jamais mélangés.

/** 'self' = le parent lui-même, sinon l'id de l'enfant. */
export type PersonKey = 'self' | (string & {});

/** Portée de lecture des relevés : child_id vide pour « Moi », child_id = l'enfant pour un enfant. */
export function personScope(person: PersonKey): { childId: string | null } {
  return { childId: person === 'self' ? null : person };
}

/** Garde de sécurité côté écran : un relevé n'est affiché que s'il appartient à la personne choisie. */
export function belongsToPerson<T extends { childId?: string }>(record: T, person: PersonKey): boolean {
  return person === 'self' ? !record.childId : record.childId === person;
}
