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

const gateway = process.env.GATEWAY_URL || 'http://localhost:8080';
const positions = [
    { id: 'drv_target_01', latitude: 21.028511, longitude: 105.854167 },
    { id: 'drv_target_02', latitude: 21.035, longitude: 105.85 },
    { id: 'drv_target_03', latitude: 21.02, longitude: 105.86 }
];
async function main() {
    assert.ok(process.env.AUTH_TOKEN, 'Set AUTH_TOKEN to a valid login token before updating driver locations');
    for (const { id, latitude, longitude } of positions) {
        const driver = await request(`${gateway}/drivers/${id}`);
        assert.equal(driver.status, 200, `${id} does not exist`);
        if (driver.data.status === 'OFFLINE') {
            assert.equal((await request(`${gateway}/drivers/${id}/go-online`, 'POST')).status, 200);
        } else {
            assert.equal(driver.data.status, 'AVAILABLE', `${id} is handling another trip`);
        }
        const result = await request(`${gateway}/drivers/${id}/location`, 'POST', { latitude, longitude });
        assert.equal(result.status, 200, `Failed location update for ${id}`);
    }
    const result = await request(`${gateway}/drivers/available?lat=21.0285&lng=105.8541&radius=3`);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data), 'Nearby response is not an array');
    for (const { id } of positions) assert.ok(result.data.some(driver => driver.id === id), `Missing nearby driver ${id}`);
    assert.ok(result.data.every(driver => Number.isFinite(driver.distance) && driver.distance <= 3));
    console.table(result.data.map(({ id, distance }) => ({ id, distance })));
    console.log('PASS: all three updated drivers are returned within 3 km.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
