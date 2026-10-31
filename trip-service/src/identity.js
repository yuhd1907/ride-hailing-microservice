'use strict';
const os = require('os');

const service = 'trip-service';
const port = Number(process.env.TRIP_SERVICE_PORT || process.env.PORT || 8083);
const hostname = process.env.HOSTNAME || os.hostname();
const instanceId = `${service}-${hostname}-${port}`;

function getIpv4Address() {
  const interfaces = os.networkInterfaces();
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries || [])
      .filter(({ family, internal }) => family === 'IPv4' && !internal)
      .map(({ address }) => ({ name, address })),
  );
  return addresses.find(({ name }) => /^eth\d+$/i.test(name))?.address || addresses[0]?.address;
}

const ipAddress = process.env.EUREKA_INSTANCE_IP || getIpv4Address();
if (!ipAddress) throw new Error('No non-internal IPv4 address found for Eureka registration');

module.exports = { service, port, hostname, instanceId, ipAddress };
