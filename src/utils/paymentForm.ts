
const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Page HTML qui soumet automatiquement l'intention de paiement (POST) vers la passerelle. */
export function buildPaymentFormHtml(intent: { actionUrl: string; payload: Record<string, unknown> }): string {
  const fields = Object.entries(intent.payload)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body onload="document.forms[0].submit()"><form method="POST" action="${esc(intent.actionUrl)}">${fields}</form></body></html>`;
}

/* ------------------------------------------------------------------------------------------------
 * Widget MultiPay / Interswitch « inline checkout » (même appel `webpayCheckout` que le web,
 * InterswitchCheckoutButton.tsx), exécuté dans la WebView de `app/payment.tsx`. Aucun secret : seuls
 * `merchant_code` / `pay_item_id` (publics côté web) sont lus depuis la configuration de l'app.
 * ---------------------------------------------------------------------------------------------- */

export interface InlineCheckoutConfig {
  merchantCode: string;
  payItemId: string;
  mode: 'TEST' | 'LIVE';
  redirectUrl: string;
  scriptUrl: string;
}

export interface InlineCheckoutRequest {
  txnRef: string;
  /** Montant en plus petite unité (chaîne), cf. `toSmallestUnit`. */
  amount: string;
  currencyNumeric: number;
  customerId: string;
  customerName: string;
  customerEmail: string;
  payItemName: string;
}

/** JSON sûr dans un `<script>` : `<`, `>`, `&` et les séparateurs de ligne sont échappés. */
const scriptJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Page HTML qui charge le script du widget et appelle `webpayCheckout`, puis poste le résultat à React Native. */
export function buildInlineCheckoutHtml(config: InlineCheckoutConfig, request: InlineCheckoutRequest): string {
  if (!/^https:\/\//i.test(config.scriptUrl)) throw new Error('Widget de paiement : URL du script non sécurisée.');
  const params = {
    merchant_code: config.merchantCode,
    pay_item_id: config.payItemId,
    amount: request.amount,
    currency: request.currencyNumeric,
    site_redirect_url: config.redirectUrl,
    txn_ref: request.txnRef,
    cust_id: request.customerId,
    cust_name: request.customerName,
    cust_email: request.customerEmail,
    pay_item_name: request.payItemName,
    mode: config.mode,
  };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script src="${esc(config.scriptUrl)}"></script>
<script>
(function () {
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function launch() {
    if (!window.webpayCheckout) { post({ type: 'error', desc: 'webpayCheckout indisponible' }); return; }
    var params = ${scriptJson(params)};
    params.onComplete = function (r) {
      post({ type: 'complete', resp: r && r.resp, payRef: r && r.payRef, txnref: r && r.txnref, desc: r && r.desc });
    };
    window.webpayCheckout(params);
  }
  window.addEventListener('load', launch);
})();
</script></body></html>`;
}

export type WidgetMessage =
  | { kind: 'success'; payRef: string }
  | { kind: 'cancelled' }
  | { kind: 'declined'; code: string; desc: string }
  | { kind: 'error'; desc: string }
  | { kind: 'ignore' };

/** Interprète un message de la WebView : `resp === '00'` + `payRef` = succès, `X1` = annulé (codes du web). */
export function parseWidgetMessage(raw: unknown): WidgetMessage {
  let msg: any;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return { kind: 'ignore' };
  }
  if (!msg || typeof msg !== 'object') return { kind: 'ignore' };
  if (msg.type === 'error') return { kind: 'error', desc: String(msg.desc ?? '') };
  if (msg.type !== 'complete') return { kind: 'ignore' };
  const resp = String(msg.resp ?? '');
  if (resp === '00') {
    const payRef = typeof msg.payRef === 'string' ? msg.payRef.trim() : '';
    return payRef ? { kind: 'success', payRef } : { kind: 'error', desc: 'payRef manquant' };
  }
  if (resp === 'X1') return { kind: 'cancelled' };
  return { kind: 'declined', code: resp, desc: String(msg.desc ?? '') };
}
