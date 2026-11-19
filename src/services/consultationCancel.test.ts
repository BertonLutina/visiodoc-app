describe('consultationCancel', () => {
  const rpc = jest.fn();
  const selectMock = jest.fn();
  const eq2 = jest.fn();
  const eq1 = jest.fn();
  const update = jest.fn();
  const from = jest.fn();
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    eq2.mockReturnValue({ select: selectMock });
    eq1.mockReturnValue({ eq: eq2 });
    update.mockReturnValue({ eq: eq1 });
    from.mockReturnValue({ update });
    jest.doMock('@/lib/supabase', () => ({ supabase: { rpc, from }, supabasePublic: null, supabaseConfigured: true }));
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
    warn.mockRestore();
  });
  const load = () => require('./consultationCancel');

  it('getCancellationCreditPreview appelle la RPC et normalise la réponse', async () => {
    rpc.mockResolvedValue({
      data: { eligible: true, rule: 'withdrawal_72h', amount: '30000.00', currency: 'CDF', deadline: '2026-11-20T10:00:00Z' },
      error: null,
    });
    const p = await load().getCancellationCreditPreview('c1');
    expect(rpc).toHaveBeenCalledWith('cancellation_credit_preview', { p_consultation_id: 'c1' });
    expect(p).toEqual({ eligible: true, rule: 'withdrawal_72h', amount: 30000, currency: 'CDF', deadline: '2026-11-20T10:00:00Z' });
  });

  it('preview : aucun crédit', async () => {
    rpc.mockResolvedValue({ data: { eligible: false, rule: 'none', amount: 0, currency: 'CDF', deadline: null }, error: null });
    expect(await load().getCancellationCreditPreview('c1')).toMatchObject({ eligible: false, rule: 'none', deadline: null });
  });

  it('preview : erreur, null ou exception donnent null sans lever', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'secret' } });
    expect(await load().getCancellationCreditPreview('c1')).toBeNull();
    expect(warn).toHaveBeenCalledWith('cancellation_credit_preview failed', '42501');
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await load().getCancellationCreditPreview('c1')).toBeNull();
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await load().getCancellationCreditPreview('c1')).toBeNull();
  });

  it("cancelScheduledConsultation : update status=cancelled filtré sur scheduled, avec select('id')", async () => {
    selectMock.mockResolvedValue({ data: [{ id: 'c1' }], error: null });
    await expect(load().cancelScheduledConsultation('c1')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('consultations');
    expect(update).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(eq1).toHaveBeenCalledWith('id', 'c1');
    expect(eq2).toHaveBeenCalledWith('status', 'scheduled');
    expect(selectMock).toHaveBeenCalledWith('id');
  });

  it('0 ligne mise à jour = erreur traduite, jamais un succès silencieux', async () => {
    selectMock.mockResolvedValue({ data: [], error: null });
    await expect(load().cancelScheduledConsultation('c1')).rejects.toThrow(/ne peut plus être annulée/);
  });

  it('erreur de base : loguée (code seul) et message traduit, jamais le message brut', async () => {
    selectMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'new row violates RLS' } });
    const err = await load().cancelScheduledConsultation('c1').catch((e: Error) => e);
    expect(err.message).toBe("L'annulation a échoué. Réessaie plus tard.");
    expect(err.message).not.toMatch(/RLS/);
    expect(warn).toHaveBeenCalledWith('cancel consultation failed', '42501');
  });

  it('exception réseau : message traduit', async () => {
    selectMock.mockRejectedValue(new Error('boom'));
    await expect(load().cancelScheduledConsultation('c1')).rejects.toThrow("L'annulation a échoué. Réessaie plus tard.");
  });
  it('buildCancellationMessage : crédit 24 h', () => {
    const { buildCancellationMessage } = load();
    const m = buildCancellationMessage({ eligible: true, rule: '24h', amount: 30000, currency: 'CDF', deadline: null });
    expect(m).toMatch(/^Si vous annulez maintenant, vous serez crédité de .*30.*dans votre portefeuille \(avoir réutilisable pour une prochaine consultation\)\.$/);
  });

  it('buildCancellationMessage : rétractation 72 h et échéance', () => {
    const { buildCancellationMessage } = load();
    const m = buildCancellationMessage({ eligible: true, rule: 'withdrawal_72h', amount: 100, currency: 'CDF', deadline: '2026-11-20T10:00:00Z' });
    expect(m).toContain('Vous êtes dans le délai de rétractation de 72 heures après votre paiement.');
    expect(m).toContain("Annulation avec crédit possible jusqu'au ");
    expect(m).not.toContain('{deadline}');
  });

  it('buildCancellationMessage : aucun crédit, ignore tout montant ou échéance', () => {
    const { buildCancellationMessage } = load();
    expect(buildCancellationMessage({ eligible: false, rule: 'none', amount: 0, currency: 'CDF', deadline: null })).toBe(
      'Moins de 24 heures avant la consultation et hors délai de rétractation : aucun crédit ne sera accordé.',
    );
  });

  it('buildCancellationMessage : aperçu indisponible = message prudent sans montant', () => {
    const m = load().buildCancellationMessage(null);
    expect(m).toBe("Le crédit éventuel sera calculé par le serveur au moment de l'annulation.");
  });
});
