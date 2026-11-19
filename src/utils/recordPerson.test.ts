import { belongsToPerson, personScope } from './recordPerson';

describe('dossier par personne : « Moi / Léa » séparés', () => {
  it('« Moi » lit les relevés sans enfant, un enfant lit les siens', () => {
    expect(personScope('self')).toEqual({ childId: null });
    expect(personScope('child-1')).toEqual({ childId: 'child-1' });
  });

  it('un relevé n’appartient qu’à une seule personne', () => {
    const mine = { childId: undefined };
    const lea = { childId: 'child-1' };
    expect(belongsToPerson(mine, 'self')).toBe(true);
    expect(belongsToPerson(lea, 'self')).toBe(false);
    expect(belongsToPerson(lea, 'child-1')).toBe(true);
    expect(belongsToPerson(mine, 'child-1')).toBe(false);
    expect(belongsToPerson(lea, 'child-2')).toBe(false);
  });
});
