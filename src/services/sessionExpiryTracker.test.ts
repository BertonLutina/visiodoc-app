import { createSessionExpiryTracker } from './sessionExpiryTracker';

describe('session expiry tracker', () => {
  it('a voluntary sign-out followed by SIGNED_OUT shows no message', () => {
    const t = createSessionExpiryTracker();
    const end = t.beginAppSignOut();
    expect(t.onSignedOut(true)).toEqual({ kind: 'voluntary', notify: false });
    end();
  });

  it('a SIGNED_OUT after a failed refresh shows the message', () => {
    const t = createSessionExpiryTracker();
    expect(t.onSignedOut(true)).toEqual({ kind: 'expired', notify: true });
  });

  it('a double SIGNED_OUT shows the message once', () => {
    const t = createSessionExpiryTracker();
    expect(t.onSignedOut(true).notify).toBe(true);
    expect(t.onSignedOut(true)).toEqual({ kind: 'expired', notify: false });
  });

  it('a genuine expiry right after a finished voluntary sign-out still shows the message', () => {
    const t = createSessionExpiryTracker();
    const end = t.beginAppSignOut();
    expect(t.onSignedOut(true).notify).toBe(false);
    end();
    expect(t.onSignedOut(true)).toEqual({ kind: 'expired', notify: true });
  });

  it('overlapping voluntary sign-outs stay voluntary until the last one ends', () => {
    const t = createSessionExpiryTracker();
    const endA = t.beginAppSignOut();
    const endB = t.beginAppSignOut();
    endA();
    expect(t.onSignedOut(true).kind).toBe('voluntary');
    endB();
    expect(t.onSignedOut(true).kind).toBe('expired');
  });

  it('ending the same sign-out twice does not corrupt the count', () => {
    const t = createSessionExpiryTracker();
    const end = t.beginAppSignOut();
    end();
    end();
    expect(t.onSignedOut(true).kind).toBe('expired');
  });

  it('a SIGNED_OUT with no session known (nobody was signed in) is ignored', () => {
    const t = createSessionExpiryTracker();
    expect(t.onSignedOut(false)).toEqual({ kind: 'ignored', notify: false });
  });

  it('claimExpiryNotice(false) (visitor who never had a session) shows nothing and does not use up the notice', () => {
    const t = createSessionExpiryTracker();
    expect(t.claimExpiryNotice(false)).toBe(false);
    expect(t.claimExpiryNotice(false)).toBe(false);
    // La vraie expiration d'une session ultérieure affiche toujours le message.
    expect(t.claimExpiryNotice(true)).toBe(true);
    expect(t.claimExpiryNotice(true)).toBe(false);
  });

  it('claimExpiryNotice (restore error / data-call report) shares the once-only flag', () => {
    const t = createSessionExpiryTracker();
    expect(t.claimExpiryNotice()).toBe(true);
    expect(t.claimExpiryNotice()).toBe(false);
    expect(t.onSignedOut(true).notify).toBe(false);
  });

  it('a new sign-in re-arms the message', () => {
    const t = createSessionExpiryTracker();
    expect(t.onSignedOut(true).notify).toBe(true);
    t.resetNotice();
    expect(t.onSignedOut(true).notify).toBe(true);
  });
});
