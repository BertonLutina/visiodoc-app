
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

export type DismissReason = 'user_left' | 'gateway_returned' | 'timeout';

export type WidgetMessage =
  | { kind: 'success'; payRef: string }
  | { kind: 'paid_unconfirmed' }
  /** Le widget a EXPLICITEMENT rapporté une annulation (X1) : définitif, la tentative peut être oubliée. */
  | { kind: 'cancelled' }
  /** Refus explicite de la banque (Z6…) : définitif. */
  | { kind: 'declined'; code: string; desc: string }
  /**
   * Aucune issue définitive : l'utilisateur a quitté l'écran (`user_left`), la passerelle est revenue sur
   * `site_redirect_url` sans résultat (`gateway_returned`) ou a expiré (`TO`, qui peut encore aboutir) :
   * la tentative est CONSERVÉE.
   */
  | { kind: 'dismissed'; reason: DismissReason }
  | { kind: 'error'; desc: string }
  | { kind: 'ignore' };

/**
 * Interprète un message de la WebView (codes du web : `resp === '00'` = payé, `X1` = annulé).
 * Le `txnref` renvoyé par le widget doit être EXACTEMENT celui de la demande (comparaison sensible à la
 * casse) : sinon le message est ignoré (un résultat étranger ne peut pas régler cette demande).
 * `00` sans `payRef` = le patient a été débité mais on ne peut pas confirmer : `paid_unconfirmed`.
 */
export function parseWidgetMessage(raw: unknown, expectedTxnRef: string): WidgetMessage {
  let msg: any;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : null;
  } catch {
    return { kind: 'ignore' };
  }
  if (!msg || typeof msg !== 'object') return { kind: 'ignore' };
  if (msg.type === 'error') return { kind: 'error', desc: String(msg.desc ?? '') };
  if (msg.type !== 'complete') return { kind: 'ignore' };
  if (typeof msg.txnref !== 'string' || msg.txnref !== expectedTxnRef) return { kind: 'ignore' };
  const resp = String(msg.resp ?? '');
  if (resp === '00') {
    const payRef = typeof msg.payRef === 'string' ? msg.payRef.trim() : '';
    return payRef ? { kind: 'success', payRef } : { kind: 'paid_unconfirmed' };
  }
  if (resp === 'X1') return { kind: 'cancelled' };
  if (resp === 'TO') return { kind: 'dismissed', reason: 'timeout' };
  return { kind: 'declined', code: resp, desc: String(msg.desc ?? '') };
}

/**
 * Politique de navigation de la WebView de paiement : TOUT `https:` (pages de banque, 3-DS, mobile money, sur
 * n'importe quel domaine, y compris les iframes) et `about:blank` ; `http:`, `javascript:`, `intent:`, `tel:`,
 * `mailto:` et les schémas personnalisés sont bloqués. L'usurpation d'un résultat est déjà couverte par la
 * correspondance exacte du `txnref` et la vérification serveur : bloquer un paiement légitime serait pire.
 */
export function isAllowedWidgetUrl(url: string): boolean {
  return url === 'about:blank' || /^https:\/\//i.test(url);
}

/** `site_redirect_url` atteinte : la passerelle est revenue, issue inconnue (à traiter, jamais à charger). */
export function isWidgetRedirect(url: string, redirectUrl: string): boolean {
  return redirectUrl.length > 0 && url.startsWith(redirectUrl);
}

/** `originWhitelist` cohérent : https, about:blank et le schéma personnalisé de l'URL de retour (deep link). */
export function widgetOriginWhitelist(redirectUrl: string): string[] {
  const list = ['https://*', 'about:blank'];
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(redirectUrl)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'https' && scheme !== 'http') list.push(`${scheme}://*`);
  return list;
}
