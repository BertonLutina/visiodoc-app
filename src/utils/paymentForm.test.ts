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
