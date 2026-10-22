const assert = require('node:assert/strict');
const gateway = process.env.GATEWAY_URL || 'http://localhost:8080';

async function main() {
    const counts = new Map();
    for (let index = 0; index < 10; index++) {
        const response = await fetch(`${gateway}/drivers/drv_target_01`, { signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200, `Request ${index + 1} did not reach Driver Service`);
        const instance = response.headers.get('X-Handled-By-Instance');
        assert.ok(instance, 'Response has no Driver instance header');
        counts.set(instance, (counts.get(instance) || 0) + 1);
        await response.arrayBuffer();
    }
    assert.equal(counts.size, 2, 'Start both Driver instances with --profile scale');
    const values = [...counts.values()];
    assert.ok(Math.abs(values[0] - values[1]) <= 2, 'Requests were not distributed evenly');
    console.table(Object.fromEntries(counts));
    console.log('PASS: 10 successful requests were distributed across both instances.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
