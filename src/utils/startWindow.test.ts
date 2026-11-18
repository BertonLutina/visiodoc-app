import {
  canStartNow,
  formatCountdown,
  providerStartWindow,
  startDeniedMessage,
  startReminderBanner,
  startWindowMessage,
} from './startWindow';
import { resetServerClock, serverNowMs, syncServerClock } from './serverClock';

const T0 = Date.parse('2026-11-17T10:00:00.000Z');
const SCHEDULED = '2026-11-17T10:00:00.000Z';

describe('providerStartWindow (guide MOB-1611-1 : de l’heure prévue à +15 min (MOB-1811-2))', () => {
  it('avant l’heure prévue : bouton grisé, temps restant avant l’ouverture', () => {
    const s = providerStartWindow(SCHEDULED, 'scheduled', T0 - 90_000);
    expect(s).toEqual({ phase: 'before', msUntilStart: 90_000 });
    expect(canStartNow(s)).toBe(false);
  });
  it('une seconde avant : encore fermé', () => {
    expect(providerStartWindow(SCHEDULED, 'scheduled', T0 - 1000).phase).toBe('before');
  });
  it('à l’heure exacte : ouvert, 15 minutes restantes', () => {
    const s = providerStartWindow(SCHEDULED, 'scheduled', T0);
    expect(s).toEqual({ phase: 'open', msLeft: 900_000 });
    expect(canStartNow(s)).toBe(true);
  });
  it('pendant la fenêtre : compte à rebours', () => {
    expect(providerStartWindow(SCHEDULED, 'scheduled', T0 + 4 * 60_000)).toEqual({ phase: 'open', msLeft: 660_000 });
  });
  it('à +15 min pile : encore ouvert ; une seconde après : dépassé', () => {
    expect(providerStartWindow(SCHEDULED, 'scheduled', T0 + 900_000).phase).toBe('open');
    const over = providerStartWindow(SCHEDULED, 'scheduled', T0 + 901_000);
    expect(over).toEqual({ phase: 'over' });
    expect(canStartNow(over)).toBe(false);
  });
  it('un appel déjà en cours n’est jamais coupé, même longtemps après', () => {
    const s = providerStartWindow(SCHEDULED, 'in_progress', T0 + 3_600_000);
    expect(s).toEqual({ phase: 'running' });
    expect(canStartNow(s)).toBe(true);
  });
  it('heure absente ou invalide : le serveur tranche (bouton actif)', () => {
    expect(canStartNow(providerStartWindow(undefined, 'scheduled', T0))).toBe(true);
    expect(providerStartWindow('pas une date', 'scheduled', T0).phase).toBe('unknown');
  });
});

describe('formatCountdown', () => {
  it('m:ss, arrondi à la seconde supérieure, jamais négatif', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(-3000)).toBe('0:00');
  });
  it('h:mm:ss au-delà d’une heure', () => {
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
  });
});

describe('horloge serveur (tolérance au décalage de l’appareil)', () => {
  afterEach(() => resetServerClock());
  it('un appareil en avance de 5 min ne déverrouille pas le bouton trop tôt', () => {
    const device = T0 - 60_000 + 5 * 60_000; // l'appareil croit être 5 min après le début
    expect(providerStartWindow(SCHEDULED, 'scheduled', device).phase).toBe('open');
    // le serveur annonce 09:59:00 (en-tête Date) alors que l'appareil indique 10:04:00
    expect(syncServerClock(new Date(T0 - 60_000).toUTCString(), device)).toBe(true);
    expect(providerStartWindow(SCHEDULED, 'scheduled', serverNowMs(device)).phase).toBe('before');
  });
  it('un appareil en retard ne bloque pas un médecin dans la fenêtre', () => {
    const device = T0 - 120_000;
    expect(syncServerClock(new Date(T0 + 60_000).toUTCString(), device)).toBe(true);
    expect(providerStartWindow(SCHEDULED, 'scheduled', serverNowMs(device)).phase).toBe('open');
  });
  it('ignore un en-tête absent, invalide ou aberrant', () => {
    expect(syncServerClock(null)).toBe(false);
    expect(syncServerClock('pas une date')).toBe(false);
    expect(syncServerClock('Mon, 01 Jan 2001 00:00:00 GMT', T0)).toBe(false);
    expect(serverNowMs(T0)).toBe(T0);
  });
});

describe('startWindowMessage / startDeniedMessage', () => {
  it('avant l’heure : temps avant l’ouverture', () => {
    expect(startWindowMessage({ phase: 'before', msUntilStart: 125_000 })).toBe("Démarrage possible à l'heure prévue, dans 2:05");
  });
  it('pendant la fenêtre : compte à rebours des 15 minutes', () => {
    expect(startWindowMessage({ phase: 'open', msLeft: 900_000 })).toBe(
      "Lancez l'appel dans les 15:00 qui restent, sinon la consultation sera annulée (médecin absent).",
    );
  });
  it('après la fenêtre : message clair, remboursement en avoir', () => {
    expect(startWindowMessage({ phase: 'over' })).toBe(
      'Délai de 15 minutes dépassé : la consultation va être annulée (médecin absent) et le patient remboursé en avoir.',
    );
  });
  it('appel en cours ou heure inconnue : aucun message', () => {
    expect(startWindowMessage({ phase: 'running' })).toBeNull();
    expect(startWindowMessage({ phase: 'unknown' })).toBeNull();
  });
  it('refus 42501 : message du guide', () => {
    expect(startDeniedMessage()).toBe(
      "Vous ne pouvez lancer l'appel qu'à partir de l'heure prévue et pendant les 15 minutes qui suivent",
    );
  });
});

describe('startReminderBanner (bandeau rouge avant la consultation suivante)', () => {
  const banner = (nowMs: number, status = 'scheduled') =>
    startReminderBanner(providerStartWindow(SCHEDULED, status, nowMs), SCHEDULED);
  it('absent à plus de 60 minutes de l’heure prévue', () => {
    expect(banner(T0 - 61 * 60_000)).toBeNull();
  });
  it('visible dès 60 minutes avant, avec l’heure et la règle des 15 minutes', () => {
    const b = banner(T0 - 60 * 60_000);
    expect(b).toMatch(/\d{2}:\d{2}/);
    expect(b).toContain('15 minutes');
    expect(b).toContain('médecin absent');
  });
  it('visible pendant la fenêtre ouverte', () => {
    expect(banner(T0 + 5 * 60_000)).not.toBeNull();
  });
  it('absent une fois la fenêtre dépassée, pour un appel en cours ou une heure inconnue', () => {
    expect(banner(T0 + 901_000)).toBeNull();
    expect(banner(T0 + 5 * 60_000, 'in_progress')).toBeNull();
    expect(startReminderBanner(providerStartWindow(undefined, 'scheduled', T0), undefined)).toBeNull();
  });
});
