import { buildPaymentFormHtml } from './paymentForm';

describe('buildPaymentFormHtml', () => {
  it('posts every payload field to actionUrl, escaping values', () => {
    const html = buildPaymentFormHtml({
      actionUrl: 'https://pay.example/collect',
      payload: { txn_ref: 'T1', amount: 500000, cust_name: 'A "B" <c>' },
    });
    expect(html).toContain('method="POST" action="https://pay.example/collect"');
    expect(html).toContain('name="amount" value="500000"');
    expect(html).toContain('value="A &quot;B&quot; &lt;c&gt;"');
    expect(html).toContain('document.forms[0].submit()');
  });
});

import { buildInlineCheckoutHtml, isAllowedWidgetUrl, parseWidgetMessage } from './paymentForm';

describe('buildInlineCheckoutHtml (same webpayCheckout call as the web InterswitchCheckoutButton)', () => {
  const config = {
    merchantCode: 'MX123',
    payItemId: 'PI456',
    mode: 'TEST' as const,
    redirectUrl: 'visiodoc://payment/callback',
    scriptUrl: 'https://webpay-ui.k8.isw.la/inline-checkout.js',
  };
  const request = {
    txnRef: 'VDC-1730745600000-ABC1234',
    amount: '3000000',
    currencyNumeric: 976,
    customerId: 'u1',
    customerName: 'Fatou </script><b>',
    customerEmail: 'f@example.com',
    payItemName: 'Consultation',
  };

  it('loads the configured script and calls webpayCheckout with the web field names', () => {
    const html = buildInlineCheckoutHtml(config, request);
    expect(html).toContain('<script src="https://webpay-ui.k8.isw.la/inline-checkout.js"></script>');
    expect(html).toContain('"merchant_code":"MX123"');
    expect(html).toContain('"pay_item_id":"PI456"');
    expect(html).toContain('"txn_ref":"VDC-1730745600000-ABC1234"');
    expect(html).toContain('"amount":"3000000"');
    expect(html).toContain('"currency":976');
    expect(html).toContain('"site_redirect_url":"visiodoc://payment/callback"');
    expect(html).toContain('"mode":"TEST"');
    expect(html).toContain('window.webpayCheckout');
    expect(html).toContain('ReactNativeWebView.postMessage');
  });

  it('cannot be broken out of by a customer name containing </script>', () => {
    const html = buildInlineCheckoutHtml(config, request);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  it('refuses a non-https script URL', () => {
    expect(() => buildInlineCheckoutHtml({ ...config, scriptUrl: 'http://evil.example/x.js' }, request)).toThrow(
      'URL du script non sécurisée',
    );
  });
});

describe('parseWidgetMessage', () => {
  const TXN = 'VDC-1730745600000-ABC1234';
  const complete = (o: Record<string, unknown>) => JSON.stringify({ type: 'complete', txnref: TXN, ...o });

  it('resp "00" with a payRef and the matching txnref is a success carrying the payRef', () => {
    expect(parseWidgetMessage(complete({ resp: '00', payRef: 'ISW_PAY_REF_987654' }), TXN)).toEqual({
      kind: 'success',
      payRef: 'ISW_PAY_REF_987654',
    });
  });

  it('a result whose txnref differs (case-sensitive) or is absent is ignored, whatever its resp', () => {
    expect(parseWidgetMessage(complete({ resp: '00', payRef: 'P', txnref: 'VDC-1730745600000-OTHER00' }), TXN)).toEqual({ kind: 'ignore' });
    expect(parseWidgetMessage(complete({ resp: '00', payRef: 'P', txnref: TXN.toLowerCase() }), TXN)).toEqual({ kind: 'ignore' });
    expect(parseWidgetMessage(JSON.stringify({ type: 'complete', resp: '00', payRef: 'P' }), TXN)).toEqual({ kind: 'ignore' });
    expect(parseWidgetMessage(complete({ resp: 'X1', txnref: 'VDC-OTHER' }), TXN)).toEqual({ kind: 'ignore' });
  });

  it('resp "00" WITHOUT a payRef = the patient was charged: paid_unconfirmed, never "unavailable"', () => {
    expect(parseWidgetMessage(complete({ resp: '00', payRef: '' }), TXN)).toEqual({ kind: 'paid_unconfirmed' });
    expect(parseWidgetMessage(complete({ resp: '00' }), TXN)).toEqual({ kind: 'paid_unconfirmed' });
  });

  it('X1 is a user cancellation; Z6 / TO are declines', () => {
    expect(parseWidgetMessage(complete({ resp: 'X1' }), TXN)).toEqual({ kind: 'cancelled' });
    expect(parseWidgetMessage(complete({ resp: 'Z6', desc: 'declined' }), TXN)).toEqual({
      kind: 'declined',
      code: 'Z6',
      desc: 'declined',
    });
    expect(parseWidgetMessage(complete({ resp: 'TO' }), TXN).kind).toBe('declined');
  });

  it('script load failure and garbage are handled', () => {
    expect(parseWidgetMessage(JSON.stringify({ type: 'error', desc: 'script' }), TXN)).toEqual({ kind: 'error', desc: 'script' });
    expect(parseWidgetMessage('not json', TXN)).toEqual({ kind: 'ignore' });
    expect(parseWidgetMessage(undefined, TXN)).toEqual({ kind: 'ignore' });
  });
});

describe('isAllowedWidgetUrl (WebView navigation allow-list)', () => {
  const config = {
    scriptUrl: 'https://webpay-ui.k8.isw.la/inline-checkout.js',
    redirectUrl: 'visiodoc://(patient)/appointments',
  };
  it('allows about:blank and the gateway host (and its sibling subdomains)', () => {
    expect(isAllowedWidgetUrl('about:blank', config)).toBe(true);
    expect(isAllowedWidgetUrl('https://webpay-ui.k8.isw.la/inline-checkout.js', config)).toBe(true);
    expect(isAllowedWidgetUrl('https://pay.k8.isw.la/checkout', config)).toBe(true);
  });
  it('blocks other hosts, look-alikes, plain http, other schemes and the app deep link', () => {
    expect(isAllowedWidgetUrl('https://evil.example/phish', config)).toBe(false);
    expect(isAllowedWidgetUrl('https://isw.la.evil.example/', config)).toBe(false);
    expect(isAllowedWidgetUrl('https://notisw.la/', config)).toBe(false);
    expect(isAllowedWidgetUrl('http://webpay-ui.k8.isw.la/', config)).toBe(false);
    expect(isAllowedWidgetUrl('javascript:alert(1)', config)).toBe(false);
    expect(isAllowedWidgetUrl('intent://x', config)).toBe(false);
    expect(isAllowedWidgetUrl('visiodoc://(patient)/appointments', config)).toBe(false);
    expect(isAllowedWidgetUrl('', config)).toBe(false);
  });
});
