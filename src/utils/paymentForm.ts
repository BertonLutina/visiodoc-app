import type { PaymentIntent } from '@/services/patientApi';

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Page HTML qui soumet automatiquement l'intention de paiement (POST) vers la passerelle. */
export function buildPaymentFormHtml(intent: Pick<PaymentIntent, 'actionUrl' | 'payload'>): string {
  const fields = Object.entries(intent.payload)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body onload="document.forms[0].submit()"><form method="POST" action="${esc(intent.actionUrl)}">${fields}</form></body></html>`;
}
