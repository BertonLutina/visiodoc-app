import { createSupportCaseNotifier } from './supportCaseNotice';

describe('createSupportCaseNotifier (alert once per txnRef per app session)', () => {
  it('returns a case the first time and never again for the same txnRef', () => {
    const n = createSupportCaseNotifier();
    const a = { consultationId: 'c1', txnRef: 'T1' };
    expect(n.takeNew([a])).toEqual([a]);
    expect(n.takeNew([a])).toEqual([]); // next focus: silent
    expect(n.takeNew([a])).toEqual([]);
  });

  it('only returns the new ones among several, and a different txnRef for the same consultation alerts again', () => {
    const n = createSupportCaseNotifier();
    n.takeNew([{ consultationId: 'c1', txnRef: 'T1' }]);
    expect(
      n.takeNew([
        { consultationId: 'c1', txnRef: 'T1' },
        { consultationId: 'c2', txnRef: 'T2' },
        { consultationId: 'c1', txnRef: 'T3' },
      ]),
    ).toEqual([
      { consultationId: 'c2', txnRef: 'T2' },
      { consultationId: 'c1', txnRef: 'T3' },
    ]);
  });

  it('does not repeat a txnRef twice inside the same batch', () => {
    const n = createSupportCaseNotifier();
    const a = { consultationId: 'c1', txnRef: 'T1' };
    expect(n.takeNew([a, a])).toEqual([a]);
  });

  it('empty input is a no-op; instances are independent (module singleton survives tab switches)', () => {
    const n = createSupportCaseNotifier();
    expect(n.takeNew([])).toEqual([]);
    const m = createSupportCaseNotifier();
    n.takeNew([{ consultationId: 'c1', txnRef: 'T1' }]);
    expect(m.takeNew([{ consultationId: 'c1', txnRef: 'T1' }])).toHaveLength(1);
  });

  it('indexes the cases by consultation for the persistent per-row line', () => {
    const n = createSupportCaseNotifier();
    expect(n.byConsultation([{ consultationId: 'c1', txnRef: 'T1' }, { consultationId: 'c2', txnRef: 'T2' }])).toEqual({
      c1: 'T1',
      c2: 'T2',
    });
  });
});
