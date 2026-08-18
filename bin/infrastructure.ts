#!/usr/bin/env node

import { App } from 'aws-cdk-lib';
import type { IVpc } from 'aws-cdk-lib/aws-ec2';
import { getEnvironmentConfig } from '../lib/config/environments';
import { getStackName } from '../lib/config/naming';
import { getDataConfig } from '../lib/stacks/data/data-config';
import { DataStack } from '../lib/stacks/data/data-stack';
import { getNetworkConfig } from '../lib/stacks/network/network-config';
import { NetworkStack } from '../lib/stacks/network/network-stack';

const app = new App();
const environmentName = app.node.tryGetContext('environment') ?? 'dev';
const environment = getEnvironmentConfig(environmentName);
const data = getDataConfig(environment.name);
const network = getNetworkConfig(environment.name);
const stackEnvironment = environment.account
  ? { account: environment.account, region: environment.region }
  : { region: environment.region };

const networkStack = new NetworkStack(app, 'NetworkStack', {
  stackName: getStackName(environment, 'network'),
  description: 'Development network for the aws-prueba project',
  env: stackEnvironment,
  projectName: environment.projectName,
  environmentName: environment.name,
  managedBy: 'aws-cdk',
  network,
});

const dataStack = new DataStack(app, 'DataStack', {
  stackName: getStackName(environment, 'data'),
  description: 'Disposable development data services for the aws-prueba project',
  env: stackEnvironment,
  projectName: environment.projectName,
  environmentName: environment.name,
  managedBy: 'aws-cdk',
  vpc: networkStack.vpc as IVpc,
  data,
});

dataStack.addStackDependency(networkStack);
