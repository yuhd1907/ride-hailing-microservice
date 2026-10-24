'use strict';
const os = require('os');
const Eureka = require('eureka-js-client').Eureka;
const appName = 'TRIP-SERVICE', port = Number(process.env.TRIP_SERVICE_PORT || process.env.PORT || 8083), hostname = process.env.HOSTNAME || os.hostname();
const client = new Eureka({ instance: { app: appName, instanceId: `${appName.toLowerCase()}-${hostname}-${port}`, hostName: hostname, ipAddr: process.env.EUREKA_INSTANCE_IP || '127.0.0.1', port: { '$': port, '@enabled': true }, vipAddress: appName.toLowerCase(), statusPageUrl: `http://localhost:${port}/ping`, healthCheckUrl: `http://localhost:${port}/ping`, dataCenterInfo: { '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo', name: 'MyOwn' } }, eureka: { host: process.env.EUREKA_HOST || 'localhost', port: Number(process.env.EUREKA_PORT || 8761), serviceUrl: { default: [`http://${process.env.EUREKA_HOST || 'localhost'}:${Number(process.env.EUREKA_PORT || 8761)}${process.env.EUREKA_SERVICE_PATH || '/eureka/apps/'}`] }, servicePath: process.env.EUREKA_SERVICE_PATH || '/eureka/apps/', heartbeatInterval: 5000, registryFetchInterval: 5000 } });
module.exports = client;
