#!/usr/bin/env node

import { App } from 'aws-cdk-lib';
import { getEnvironmentConfig } from '../lib/config/environments';
import { FoundationStack } from '../lib/foundation-stack';

const app = new App();
const environmentName = app.node.tryGetContext('environment') ?? 'dev';
const environment = getEnvironmentConfig(environmentName);
const stackEnvironment = environment.account
  ? { account: environment.account, region: environment.region }
  : { region: environment.region };

new FoundationStack(app, 'DevFoundationStack', {
  stackName: environment.stackName,
  description: 'Development foundation for the aws-prueba project',
  environmentName: environment.name,
});
