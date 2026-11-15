import test from 'node:test';
import assert from 'node:assert/strict';
import { emailRequestId, sendAdminEmail } from '../src/lib/adminEmail.js';
import { deliveryOutcome, retryDelay } from '../supabase/functions/_shared/emailRetry.mjs';

const requestId = 'd66f290b-d06a-4bde-9d52-de04aa218dbe';
const payload = { recipients: [' A@example.com ', 'a@example.com', 'b@example.com'], subject: ' Notice ', message: ' Hello ', requestId };
test('sends normalized, deduplicated addresses and the stable request ID', async () => {
    const result = await sendAdminEmail(async (name, options) => {
        assert.equal(name, 'existing-function');
        assert.deepEqual(options.body, { recipients: ['a@example.com', 'b@example.com'], subject: 'Notice', message: 'Hello', requestId });
        return { data: { queued: 2, requested: 2, batchId: requestId }, error: null };
    }, 'existing-function', payload);
    assert.deepEqual(result, { queued: 2, batchId: requestId });
});
test('retains legacy accepted-count responses during deployment', async () => {
    assert.deepEqual(await sendAdminEmail(async () => ({ data: { sent: 2, requested: 2 } }), 'existing-function', payload), { sent: 2 });
});
test('reports accepted recipients on legacy partial failure without retrying', async () => {
    let calls = 0;
    await assert.rejects(sendAdminEmail(async () => {
        calls++;
        return { error: { context: { json: async () => ({ error: 'Email delivery request failed.', sent: 1, requested: 2 }) } } };
    }, 'existing-function', payload), (error) => {
        assert.deepEqual(error.acceptedRecipients, ['a@example.com']);
        return true;
    });
    assert.equal(calls, 1);
});
test('rejects oversized messages and recipient lists before invoking', async () => {
    const invoke = () => assert.fail('must not invoke');
    await assert.rejects(sendAdminEmail(invoke, 'existing-function', { ...payload, message: 'x'.repeat(10001) }));
    await assert.rejects(sendAdminEmail(invoke, 'existing-function', { ...payload, recipients: Array.from({ length: 21 }, (_, i) => `${i}@example.com`) }));
});
test('unknown submission state and unexpected response bodies never claim success', async () => {
    for (const invoke of [async () => { throw new Error('network'); }, async () => ({ data: {} }),
        async () => ({ data: { queued: 2, requested: 2, batchId: 'wrong-id' } })]) {
        await assert.rejects(sendAdminEmail(invoke, 'existing-function', payload), /[Cc]ould not confirm submission/);
    }
});
test('server cooldown is exposed without automatically resubmitting', async () => {
    await assert.rejects(sendAdminEmail(async () => ({ error: { context: { json: async () => ({ error: 'Wait.', retryAfter: 29 }) } } }), 'existing-function', payload), (error) => error.retryAfter === 29);
});
test('draft hash reuses request IDs after reload, without storing draft contents', async () => {
    const entries = new Map();
    const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
    const first = await emailRequestId(storage, 'admin1', payload);
    assert.equal(await emailRequestId(storage, 'admin1', { ...payload, recipients: ['b@example.com', 'a@example.com'] }), first);
    assert.notEqual(await emailRequestId(storage, 'admin1', { ...payload, message: 'Different' }), first);
    assert.notEqual(await emailRequestId(storage, 'admin2', payload), first);
    assert.ok(!entries.get('admin1').includes('example.com'));
    assert.ok(!entries.get('admin1').includes('Different'));
});
test('rate-limit retry honors Retry-After including HTTP dates', () => {
    assert.equal(retryDelay('120', 1), 120);
    assert.equal(retryDelay('bad', 3), 8);
    assert.equal(retryDelay(null, 3), 8);
    assert.equal(retryDelay('Thu, 01 Jan 1970 00:02:00 GMT', 1, 0), 120);
    const outcome = deliveryOutcome(429, {}, '120', 1);
    assert.equal(outcome.pause, true);
    assert.equal(outcome.status, 'pending');
    assert.equal(outcome.delay, 120);
});
test('timeouts and transient failures retry; permanent failures and exhaustion stop', () => {
    for (const status of [0, 500, 503]) assert.equal(deliveryOutcome(status, null, null, 1).status, 'pending');
    assert.equal(deliveryOutcome(409, { name: 'concurrent_idempotent_requests' }, null, 1).status, 'pending');
    assert.equal(deliveryOutcome(409, { name: 'invalid_idempotent_request' }, null, 1).status, 'failed');
    assert.equal(deliveryOutcome(403, {}, null, 1).status, 'failed');
    assert.equal(deliveryOutcome(0, null, null, 8).status, 'needs_review');
    assert.equal(deliveryOutcome(200, {}, null, 1).status, 'pending');
    assert.equal(deliveryOutcome(200, { id: 'provider-id' }, null, 1).status, 'sent');
});

test('long provider retry windows are never shortened to one day', () => {
    assert.equal(retryDelay('172800', 1), 172800);
});

test('authorization rejection states that nothing was queued without an ambiguous-send warning', async () => {
    for (const status of [401, 403]) {
        await assert.rejects(sendAdminEmail(async () => ({ error: { context: { status, json: async () => ({ error: 'Access denied.' }) } } }), 'existing-function', payload), (error) => {
            assert.match(error.message, /No email was queued/);
            assert.doesNotMatch(error.message, /Could not confirm|Resend activity/);
            return true;
        });
    }
});
