'use strict';
const Eureka = require('eureka-js-client').Eureka;
const identity = require('./identity');
const appName = identity.service.toUpperCase();
const client = new Eureka({ instance: { app: appName, instanceId: identity.instanceId, hostName: identity.hostname, ipAddr: identity.ipAddress, port: { '$': identity.port, '@enabled': true }, vipAddress: appName.toLowerCase(), statusPageUrl: `http://${identity.ipAddress}:${identity.port}/ping`, healthCheckUrl: `http://${identity.ipAddress}:${identity.port}/ping`, dataCenterInfo: { '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo', name: 'MyOwn' } }, eureka: { host: process.env.EUREKA_HOST || 'localhost', port: Number(process.env.EUREKA_PORT || 8761), serviceUrl: { default: [`http://${process.env.EUREKA_HOST || 'localhost'}:${Number(process.env.EUREKA_PORT || 8761)}${process.env.EUREKA_SERVICE_PATH || '/eureka/apps/'}`] }, servicePath: process.env.EUREKA_SERVICE_PATH || '/eureka/apps/', heartbeatInterval: 5000, registryFetchInterval: 5000 } });
module.exports = client;
