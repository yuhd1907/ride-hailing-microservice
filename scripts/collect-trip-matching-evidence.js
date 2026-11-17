'use strict';
// Summarize real Gradle JUnit XML reports; never manufacture successful results.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/evidence/phase3');
fs.mkdirSync(output, { recursive: true });
const node = spawnSync(process.execPath, ['--test', 'scripts/trip-matching.test.js', 'scripts/trip-matching-phase3.test.js'], { cwd: root, encoding: 'utf8' });
fs.writeFileSync(path.join(output, 'trip-matching-node-tests.txt'), node.stdout + node.stderr);
process.stdout.write(node.stdout + node.stderr);
let failures = node.status !== 0;
const suites = [];
for (const service of ['api-gateway', 'driver-service', 'eureka-server', 'notification-service', 'payment-service', 'user-service']) {
  const directory = path.join(root, service, 'build/test-results/test');
  if (!fs.existsSync(directory)) {
    suites.push({ service, note: service === 'eureka-server' ? 'No Java test source in this module' : 'Missing JUnit reports' });
    if (service !== 'eureka-server') failures = true;
    continue;
  }
  const result = { service, tests: 0, failures: 0, errors: 0, skipped: 0, suites: [] };
  for (const file of fs.readdirSync(directory).filter(name => name.startsWith('TEST-') && name.endsWith('.xml'))) {
    const xml = fs.readFileSync(path.join(directory, file), 'utf8');
    const header = xml.match(/<testsuite\s[^>]*>/)?.[0];
    if (!header) throw new Error(`Invalid JUnit XML: ${file}`);
    const attributes = Object.fromEntries([...header.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    for (const field of ['tests', 'failures', 'errors', 'skipped']) result[field] += Number(attributes[field] || 0);
    result.suites.push({ name: attributes.name, timestamp: attributes.timestamp, tests: Number(attributes.tests), failures: Number(attributes.failures), errors: Number(attributes.errors), skipped: Number(attributes.skipped) });
  }
  failures ||= result.failures > 0 || result.errors > 0 || result.tests === 0;
  suites.push(result);
}
const summary = { collectedAt: new Date().toISOString(), source: 'Actual Gradle build/test-results/test/TEST-*.xml; timestamps may include unchanged up-to-date tasks', nodeExitCode: node.status, java: suites };
fs.writeFileSync(path.join(output, 'trip-matching-java-tests.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(suites.map(({ suites, ...summary }) => summary), null, 2));
process.exitCode = failures ? 1 : 0;
