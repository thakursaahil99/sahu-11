// Wallet checks over HTTP against a running API in demo mode.
const API = process.env.API_URL ?? 'http://localhost:4000';
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`);
};
async function call(method, path, body, token, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const phone = '7' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
await call('POST', '/auth/otp/request', { phone });
const v = await call('POST', '/auth/otp/verify', { phone, code: '123456' });
const reg = await call('POST', '/auth/register/phone', { signupToken: v.body.signupToken, name: 'Wallet Tester', dob: '1992-02-02', acceptTerms: true });
const token = reg.body.tokens.accessToken;

let r = await call('GET', '/wallet', null, token);
check('demo wallet with welcome bonus', r.status === 200 && r.body.mode === 'demo' && r.body.primary === 'DEMO' && r.body.balances[0].bonus === 1000, JSON.stringify(r.body));
check('deposits and withdrawals are off in demo', r.body.depositsEnabled === false && r.body.withdrawalsEnabled === false);
await Promise.all([call('GET', '/wallet', null, token), call('GET', '/wallet', null, token), call('GET', '/wallet', null, token)]);
r = await call('GET', '/wallet', null, token);
check('welcome bonus granted exactly once (even under concurrent calls)', r.body.balances[0].total === 1000, JSON.stringify(r.body.balances));

r = await call('GET', '/wallet/transactions', null, token);
check('history lists the bonus', r.status === 200 && r.body.items.length === 1 && r.body.items[0].type === 'BONUS' && r.body.items[0].status === 'SUCCESS');

r = await call('POST', '/wallet/deposits', { amount: 100 }, token);
check('deposit refused in demo (403)', r.status === 403 && /demo/.test(r.body.message), JSON.stringify(r.body));
r = await call('POST', '/wallet/deposits', { amount: 5 }, token);
check('deposit below minimum is a validation error', r.status === 400 && r.body.fields?.amount);
r = await call('POST', '/wallet/withdrawals', { amount: 100 }, token);
check('withdrawal refused in demo (403)', r.status === 403);

r = await call('GET', '/me/kyc', null, token);
check('KYC starts NOT_STARTED', r.body.status === 'NOT_STARTED');
r = await call('POST', '/me/kyc', { fullName: 'Wallet Tester', pan: 'abcde1234' }, token);
check('invalid PAN rejected', r.status === 400 && r.body.fields?.pan);
const pan = `WALLT${String(Date.now()).slice(-4)}Z`;
r = await call('POST', '/me/kyc', { fullName: 'Wallet Tester', pan: pan.toLowerCase() }, token);
check('KYC submitted, PAN masked', r.status === 201 && r.body.status === 'PENDING' && r.body.panMasked === `WAXXXXX${pan.slice(-3)}` && !JSON.stringify(r.body).includes(pan), JSON.stringify(r.body));

r = await call('POST', '/webhooks/razorpay', { event: 'payment.captured' }, null, { 'x-razorpay-signature': 'deadbeef' });
check('webhook with bad signature rejected', r.status === 401);
r = await call('POST', '/webhooks/razorpay', { event: 'payment.captured' }, null);
check('webhook without signature rejected', r.status === 401);
r = await call('GET', '/pay/somebogusid?t=forged', null, null);
check('checkout page with a forged token refused', r.status === 403);
r = await call('POST', '/payments/razorpay/complete', { t: 'forged.token.value', razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 'a'.repeat(64) }, null);
check('checkout completion with forged token refused', r.status === 403);

r = await call('GET', '/wallet', null, null);
check('wallet requires auth', r.status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
