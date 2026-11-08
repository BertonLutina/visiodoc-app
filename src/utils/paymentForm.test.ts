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

import {
  buildInlineCheckoutHtml,
  isAllowedWidgetUrl,
  isWidgetRedirect,
  parseWidgetMessage,
  widgetOriginWhitelist,
} from './paymentForm';

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

  it('X1 is an explicit user cancellation; Z6 is an explicit decline', () => {
    expect(parseWidgetMessage(complete({ resp: 'X1' }), TXN)).toEqual({ kind: 'cancelled' });
    expect(parseWidgetMessage(complete({ resp: 'Z6', desc: 'declined' }), TXN)).toEqual({
      kind: 'declined',
      code: 'Z6',
      desc: 'declined',
    });
  });

  it('any other resp code is not definitive: it follows the user_left flow ("Tu as été débité ?"), never cancelled', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const resp of ['Z1', 'T0', '99', 'WHATEVER']) {
      expect(parseWidgetMessage(complete({ resp, desc: 'x' }), TXN)).toEqual({ kind: 'dismissed', reason: 'user_left' });
    }
    expect(parseWidgetMessage(complete({}), TXN)).toEqual({ kind: 'dismissed', reason: 'user_left' });
    warn.mockRestore();
  });

  it('logs ONLY the unknown code with console.warn (no desc / payRef / txnref / PII) so the list can be tightened', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    parseWidgetMessage(complete({ resp: 'Z1', desc: 'John Doe card 4111', payRef: 'SECRET' }), TXN);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain('Z1');
    for (const secret of ['John', '4111', 'SECRET', TXN]) expect(logged).not.toContain(secret);
    warn.mockClear();
    parseWidgetMessage(complete({ resp: 'X1' }), TXN); // known codes do not warn
    parseWidgetMessage(complete({ resp: 'Z6' }), TXN);
    parseWidgetMessage(complete({ resp: 'TO' }), TXN);
    parseWidgetMessage(complete({ resp: '00', payRef: 'P' }), TXN);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('TO (gateway timeout) is NOT definitive: a timeout can still succeed, so it is "dismissed/timeout"', () => {
    expect(parseWidgetMessage(complete({ resp: 'TO' }), TXN)).toEqual({ kind: 'dismissed', reason: 'timeout' });
  });

  it('script load failure and garbage are handled', () => {
    expect(parseWidgetMessage(JSON.stringify({ type: 'error', desc: 'script' }), TXN)).toEqual({ kind: 'error', desc: 'script' });
    expect(parseWidgetMessage('not json', TXN)).toEqual({ kind: 'ignore' });
    expect(parseWidgetMessage(undefined, TXN)).toEqual({ kind: 'ignore' });
  });
});

describe('isAllowedWidgetUrl (WebView navigation policy: never block a bank / 3-DS / mobile-money page)', () => {
  it('allows about:blank and every https URL, whatever the domain (top-level and iframes)', () => {
    expect(isAllowedWidgetUrl('about:blank')).toBe(true);
    expect(isAllowedWidgetUrl('https://webpay-ui.k8.isw.la/inline-checkout.js')).toBe(true);
    expect(isAllowedWidgetUrl('https://secure.mybank.example/3ds?x=1')).toBe(true);
    expect(isAllowedWidgetUrl('https://pay.mobile-money.example:8443/otp')).toBe(true);
    expect(isAllowedWidgetUrl('HTTPS://UPPER.EXAMPLE/')).toBe(true);
  });
  it('allows any about: URL', () => {
    expect(isAllowedWidgetUrl('about:srcdoc')).toBe(true);
    expect(isAllowedWidgetUrl('ABOUT:blank#x')).toBe(true);
  });
  it('allows blob: and data: for NON-top frames only', () => {
    expect(isAllowedWidgetUrl('blob:https://pay.example/uuid', false)).toBe(true);
    expect(isAllowedWidgetUrl('data:text/html;base64,AAAA', false)).toBe(true);
    expect(isAllowedWidgetUrl('blob:https://pay.example/uuid', true)).toBe(false);
    expect(isAllowedWidgetUrl('data:text/html;base64,AAAA', true)).toBe(false);
    expect(isAllowedWidgetUrl('data:text/html;base64,AAAA')).toBe(false); // top-level by default
  });
  it('still blocks http, javascript:, intent: and custom schemes in sub-frames too', () => {
    expect(isAllowedWidgetUrl('http://x.example/', false)).toBe(false);
    expect(isAllowedWidgetUrl('javascript:alert(1)', false)).toBe(false);
    expect(isAllowedWidgetUrl('myapp://x', false)).toBe(false);
  });
  it('blocks plain http, unknown custom schemes, javascript:, intent: and empty URLs', () => {
    expect(isAllowedWidgetUrl('http://webpay-ui.k8.isw.la/')).toBe(false);
    expect(isAllowedWidgetUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedWidgetUrl('intent://x#Intent;end')).toBe(false);
    expect(isAllowedWidgetUrl('tel:+243810000001')).toBe(false);
    expect(isAllowedWidgetUrl('mailto:a@b.c')).toBe(false);
    expect(isAllowedWidgetUrl('myapp://anything')).toBe(false);
    expect(isAllowedWidgetUrl('')).toBe(false);
  });
});

describe('isWidgetRedirect (site_redirect_url hit = gateway returned, outcome unknown)', () => {
  it('matches URLs starting with the configured redirect URL only', () => {
    expect(isWidgetRedirect('visiodoc://(patient)/appointments?x=1', 'visiodoc://(patient)/appointments')).toBe(true);
    expect(isWidgetRedirect('https://x.example/back?ref=1', 'https://x.example/back')).toBe(true);
    expect(isWidgetRedirect('https://x.example/other', 'https://x.example/back')).toBe(false);
    expect(isWidgetRedirect('visiodoc://other', 'visiodoc://(patient)/appointments')).toBe(false);
  });
});

describe('widgetOriginWhitelist', () => {
  it('is https + about:blank, plus the custom scheme of the redirect URL', () => {
    expect(widgetOriginWhitelist('visiodoc://(patient)/appointments')).toEqual(['https://*', 'about:blank', 'visiodoc://*']);
    expect(widgetOriginWhitelist('exp://192.168.1.2:8081/--/appointments')).toEqual(['https://*', 'about:blank', 'exp://*']);
  });
  it('does not add anything for an https redirect URL', () => {
    expect(widgetOriginWhitelist('https://x.example/back')).toEqual(['https://*', 'about:blank']);
  });
});
