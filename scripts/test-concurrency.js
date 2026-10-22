const assert = require('node:assert/strict');

async function request(url, method = 'GET', body) {
    const response = await fetch(url, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(process.env.AUTH_TOKEN ? { Authorization: `Bearer ${process.env.AUTH_TOKEN}` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`Invalid JSON from ${url}: HTTP ${response.status}`); }
    return { status: response.status, data, instance: response.headers.get('X-Handled-By-Instance') };
}

const first = process.env.DRIVER_SERVICE_URL_1 || 'http://localhost:8082';
const second = process.env.DRIVER_SERVICE_URL_2 || 'http://localhost:18082';
const driverId = process.env.TEST_DRIVER_ID || 'drv_target_01';

async function main() {
    const current = await request(`${first}/drivers/${driverId}`);
    assert.equal(current.status, 200, 'Test driver is unavailable');
    if (current.data.status === 'OFFLINE') {
        assert.equal((await request(`${first}/drivers/${driverId}/go-online`, 'POST')).status, 200);
    } else {
        assert.equal(current.data.status, 'AVAILABLE', 'Use an AVAILABLE demo driver, not a driver handling another trip');
    }
    const suffix = Date.now();
    const reservations = [`rsv_verify_${suffix}_1`, `rsv_verify_${suffix}_2`];
    try {
        const results = await Promise.all([first, second].map((base, index) =>
            request(`${base}/internal/drivers/${driverId}/reserve`, 'POST', {
                tripId: `trip_verify_${suffix}_${index + 1}`, reservationId: reservations[index]
            })));
        console.table(results.map(result => ({ status: result.status, instance: result.instance })));
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409],
            'Concurrent reservations must have exactly one winner');
        console.log('PASS: two Driver instances produced one 200 and one 409.');
    } finally {
        const after = await request(`${first}/drivers/${driverId}`);
        if (after.status === 200 && reservations.includes(after.data.reservationId)) {
            assert.equal((await request(`${first}/internal/drivers/${driverId}/release`, 'POST')).status, 200,
                'Could not release the reservation created by this test');
        }
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
