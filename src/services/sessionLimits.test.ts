import { createSessionClock, INACTIVITY_LIMIT_MS, MAX_SESSION_MS, PERSIST_EVERY_MS, sessionLimitReached } from './sessionLimits';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('sessionLimitReached', () => {
  const clock = (signedInAgo: number, activeAgo: number) => ({ signedInAt: 1_000_000_000 - signedInAgo, lastActivityAt: 1_000_000_000 - activeAgo });
  const now = 1_000_000_000;

  it('59 min d’inactivité : rien', () => expect(sessionLimitReached(clock(2 * HOUR, 59 * MIN), now)).toBeNull());
  it('61 min d’inactivité : inactivité', () => expect(sessionLimitReached(clock(2 * HOUR, 61 * MIN), now)).toBe('inactivity'));
  it('pile 1 h d’inactivité : inactivité', () => expect(sessionLimitReached(clock(2 * HOUR, INACTIVITY_LIMIT_MS), now)).toBe('inactivity'));
  it('11 h 59 depuis la connexion, actif : rien', () => expect(sessionLimitReached(clock(11 * HOUR + 59 * MIN, MIN), now)).toBeNull());
  it('12 h 01 depuis la connexion, même actif : durée maximale', () => expect(sessionLimitReached(clock(12 * HOUR + MIN, MIN), now)).toBe('max_duration'));
  it('pile 12 h : durée maximale, avant l’inactivité', () => expect(sessionLimitReached(clock(MAX_SESSION_MS, 2 * HOUR), now)).toBe('max_duration'));
  it('horloge de l’appareil reculée : pas de déconnexion', () => expect(sessionLimitReached({ signedInAt: now + HOUR, lastActivityAt: now + HOUR }, now)).toBeNull());
});

function makeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: jest.fn(async (k: string) => data[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => { data[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete data[k]; }),
  };
}

describe('createSessionClock', () => {
  it('sans session : rien à vérifier, touch sans effet', () => {
    let t = 0;
    const c = createSessionClock(makeStorage(), () => t);
    c.touch();
    expect(c.check()).toBeNull();
  });

  it('un toucher repousse l’inactivité mais pas la durée maximale', async () => {
    let t = 1_000;
    const c = createSessionClock(makeStorage(), () => t);
    await c.start();
    t += 50 * MIN; c.touch();
    t += 50 * MIN;
    expect(c.check()).toBeNull(); // 50 min depuis le dernier toucher
    t += 11 * HOUR;
    c.touch();
    expect(c.check()).toBe('max_duration');
  });

  it('sans toucher pendant 1 h : inactivité', async () => {
    let t = 1_000;
    const c = createSessionClock(makeStorage(), () => t);
    await c.start();
    t += HOUR;
    expect(c.check()).toBe('inactivity');
  });

  it('restaure l’horloge persistée : app fermée plus d’1 h = inactivité', async () => {
    let t = 5_000_000;
    const storage = makeStorage();
    const first = createSessionClock(storage, () => t);
    await first.start();
    t += 90 * MIN; // app fermée 90 min
    const second = createSessionClock(storage, () => t);
    await second.restore();
    expect(second.check()).toBe('inactivity');
  });

  it('horloge absente ou illisible : repart de maintenant (jamais de déconnexion à tort)', async () => {
    const t = 9_000_000;
    for (const raw of [undefined, 'pas du json', '{"signedInAt":"x"}']) {
      const c = createSessionClock(makeStorage(raw === undefined ? {} : { 'visiodoc.sessionClock.v1': raw }), () => t);
      await c.restore();
      expect(c.check()).toBeNull();
    }
  });

  it('écrit sur disque au plus toutes les 30 s', async () => {
    let t = 1_000;
    const storage = makeStorage();
    const c = createSessionClock(storage, () => t);
    await c.start();
    storage.setItem.mockClear();
    t += 5_000; c.touch(); t += 5_000; c.touch();
    expect(storage.setItem).not.toHaveBeenCalled();
    t += PERSIST_EVERY_MS; c.touch();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('panne de stockage : la session continue', async () => {
    const storage = makeStorage();
    storage.setItem.mockRejectedValue(new Error('disk'));
    storage.getItem.mockRejectedValue(new Error('disk'));
    const c = createSessionClock(storage, () => 1_000);
    await expect(c.start()).resolves.toBeUndefined();
    await expect(c.restore()).resolves.toBeUndefined();
    expect(c.check()).toBeNull();
  });

  it('clear : plus de suivi', async () => {
    let t = 1_000;
    const c = createSessionClock(makeStorage(), () => t);
    await c.start();
    await c.clear();
    t += 20 * HOUR;
    expect(c.check()).toBeNull();
  });
});
