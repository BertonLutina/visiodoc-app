function makeChain(result: any) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update']) chain[m] = jest.fn(() => chain);
  chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return chain;
}

function load(client: any) {
  jest.resetModules();
  jest.doMock('@/lib/supabase', () => ({ supabase: client, supabaseConfigured: !!client }));
  return require('./notifications');
}

afterEach(() => jest.dontMock('@/lib/supabase'));

describe('listNotifications', () => {
  it('filtre sur recipient_id, trie du plus récent et limite', async () => {
    const rows = [{ id: 'n1' }];
    const chain = makeChain({ data: rows, error: null });
    const from = jest.fn(() => chain);
    const { listNotifications } = load({ from });
    await expect(listNotifications('u-1', 20)).resolves.toEqual(rows);
    expect(from).toHaveBeenCalledWith('in_app_notifications');
    expect(chain.select.mock.calls[0][0]).toContain('read_at');
    expect(chain.eq).toHaveBeenCalledWith('recipient_id', 'u-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(20);
  });

  it('propage une erreur', async () => {
    const { listNotifications } = load({ from: () => makeChain({ data: null, error: { message: 'boom' } }) });
    await expect(listNotifications('u-1')).rejects.toMatchObject({ message: 'boom' });
  });

  it('renvoie une liste vide sans Supabase (mode démo)', async () => {
    const { listNotifications } = load(null);
    await expect(listNotifications('u-1')).resolves.toEqual([]);
  });
});

describe('countUnreadNotifications', () => {
  it('compte les lignes non lues du destinataire', async () => {
    const chain = makeChain({ count: 3, error: null });
    const { countUnreadNotifications } = load({ from: () => chain });
    await expect(countUnreadNotifications('u-1')).resolves.toBe(3);
    expect(chain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(chain.eq).toHaveBeenCalledWith('recipient_id', 'u-1');
    expect(chain.is).toHaveBeenCalledWith('read_at', null);
  });

  it('renvoie 0 si count est null', async () => {
    const { countUnreadNotifications } = load({ from: () => makeChain({ count: null, error: null }) });
    await expect(countUnreadNotifications('u-1')).resolves.toBe(0);
  });
});

describe('marquage lu', () => {
  it('markNotificationRead met read_at sur la ligne', async () => {
    const chain = makeChain({ error: null });
    const { markNotificationRead } = load({ from: () => chain });
    await markNotificationRead('n1', '2026-11-19T10:00:00.000Z');
    expect(chain.update).toHaveBeenCalledWith({ read_at: '2026-11-19T10:00:00.000Z' });
    expect(chain.eq).toHaveBeenCalledWith('id', 'n1');
  });

  it('markAllNotificationsRead ne touche que les non lues du destinataire', async () => {
    const chain = makeChain({ error: null });
    const { markAllNotificationsRead } = load({ from: () => chain });
    await markAllNotificationsRead('u-1', '2026-11-19T10:00:00.000Z');
    expect(chain.update).toHaveBeenCalledWith({ read_at: '2026-11-19T10:00:00.000Z' });
    expect(chain.eq).toHaveBeenCalledWith('recipient_id', 'u-1');
    expect(chain.is).toHaveBeenCalledWith('read_at', null);
  });

  it('propage une erreur de mise à jour', async () => {
    const { markNotificationRead } = load({ from: () => makeChain({ error: { message: 'rls' } }) });
    await expect(markNotificationRead('n1')).rejects.toMatchObject({ message: 'rls' });
  });
});

describe('subscribeToNotifications', () => {
  it('écoute les INSERT du destinataire et se désabonne', () => {
    const channelObj: any = {};
    channelObj.on = jest.fn(() => channelObj);
    channelObj.subscribe = jest.fn(() => channelObj);
    const removeChannel = jest.fn();
    const { subscribeToNotifications } = load({ channel: jest.fn(() => channelObj), removeChannel });
    const onInsert = jest.fn();
    const stop = subscribeToNotifications('u-1', onInsert);
    const [evt, filter, cb] = channelObj.on.mock.calls[0];
    expect(evt).toBe('postgres_changes');
    expect(filter).toMatchObject({ event: 'INSERT', table: 'in_app_notifications', filter: 'recipient_id=eq.u-1' });
    cb({ new: { id: 'n9' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 'n9' });
    stop();
    expect(removeChannel).toHaveBeenCalledWith(channelObj);
  });
});

describe('notificationRoute', () => {
  const { notificationRoute } = require('./notifications');
  it('route le patient', () => {
    expect(notificationRoute('consultation_started', 'patient')).toBe('/(patient)/appointments');
    expect(notificationRoute('prescription_issued', 'patient')).toBe('/records');
    expect(notificationRoute('cancellation_credit', 'patient')).toBe('/(patient)/wallet');
    expect(notificationRoute('provider_absent', 'patient')).toBe('/(patient)/wallet');
  });
  it('route le prestataire', () => {
    expect(notificationRoute('provider_absent', 'provider')).toBe('/(provider)/consultations');
    expect(notificationRoute('subscription_expiry_reminder', 'provider')).toBe('/provider/subscription');
    expect(notificationRoute('avatar_review', 'provider')).toBe('/(provider)/profile');
  });
  it('traduit action_url web si le type est inconnu', () => {
    expect(notificationRoute('x', 'patient', '/?view=my-consultations')).toBe('/(patient)/appointments');
    expect(notificationRoute('x', 'patient', '/?view=my-prescriptions')).toBe('/records');
    expect(notificationRoute('x', 'provider', '/?view=my-consultations')).toBeNull();
    expect(notificationRoute('x', 'patient', null)).toBeNull();
  });
  it('renvoie null pour un type inconnu', () => {
    expect(notificationRoute('payment_alert', 'patient')).toBeNull();
    expect(notificationRoute('nope', 'provider')).toBeNull();
  });
});
