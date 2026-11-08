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

import { buildInlineCheckoutHtml, parseWidgetMessage } from './paymentForm';

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
    expect(() => buildInlineCheckoutHtml({ ...config, scriptUrl: 'http://evil.example/x.js' }, request)).toThrow();
  });
});

describe('parseWidgetMessage', () => {
  it('resp "00" with a payRef is a success carrying the payRef', () => {
    expect(
      parseWidgetMessage(JSON.stringify({ type: 'complete', resp: '00', payRef: 'ISW_PAY_REF_987654', txnref: 'T' })),
    ).toEqual({ kind: 'success', payRef: 'ISW_PAY_REF_987654' });
  });

  it('resp "00" WITHOUT a payRef is not a success (confirm needs the provider reference)', () => {
    expect(parseWidgetMessage(JSON.stringify({ type: 'complete', resp: '00', payRef: '' })).kind).toBe('error');
  });

  it('X1 is a user cancellation; Z6 / TO are declines', () => {
    expect(parseWidgetMessage(JSON.stringify({ type: 'complete', resp: 'X1' }))).toEqual({ kind: 'cancelled' });
    expect(parseWidgetMessage(JSON.stringify({ type: 'complete', resp: 'Z6', desc: 'declined' }))).toEqual({
      kind: 'declined',
      code: 'Z6',
      desc: 'declined',
    });
    expect(parseWidgetMessage(JSON.stringify({ type: 'complete', resp: 'TO' })).kind).toBe('declined');
  });

  it('script load failure and garbage are handled', () => {
    expect(parseWidgetMessage(JSON.stringify({ type: 'error', desc: 'script' }))).toEqual({ kind: 'error', desc: 'script' });
    expect(parseWidgetMessage('not json')).toEqual({ kind: 'ignore' });
    expect(parseWidgetMessage(undefined)).toEqual({ kind: 'ignore' });
  });
});
