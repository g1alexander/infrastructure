#!/usr/bin/env node

import { App } from 'aws-cdk-lib';
import type { IVpc } from 'aws-cdk-lib/aws-ec2';
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { resolve } from 'node:path';
import { getEnvironmentConfig } from '../lib/config/environments';
import { getStackName } from '../lib/config/naming';
import { getComputeConfig } from '../lib/stacks/compute/compute-config';
import { ComputeStack } from '../lib/stacks/compute/compute-stack';
import { getDataConfig } from '../lib/stacks/data/data-config';
import { DataStack } from '../lib/stacks/data/data-stack';
import { getNetworkConfig } from '../lib/stacks/network/network-config';
import { NetworkStack } from '../lib/stacks/network/network-stack';
import { getServerlessConfig } from '../lib/stacks/serverless/serverless-config';
import { ServerlessStack } from '../lib/stacks/serverless/serverless-stack';

const app = new App();
const environmentName = app.node.tryGetContext('environment') ?? 'dev';
const environment = getEnvironmentConfig(environmentName);
const compute = getComputeConfig(environment.name);
const data = getDataConfig(environment.name);
const network = getNetworkConfig(environment.name);
const serverless = getServerlessConfig(environment.name);
const workspaceRoot = resolve(__dirname, '..', '..');
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

const serverlessStack = new ServerlessStack(app, 'ServerlessStack', {
  stackName: getStackName(environment, 'serverless'),
  description: 'Disposable development serverless services for the aws-prueba project',
  env: stackEnvironment,
  projectName: environment.projectName,
  environmentName: environment.name,
  managedBy: 'aws-cdk',
  javascriptSourcePath: resolve(workspaceRoot, 'lambda-js'),
  pythonSourcePath: resolve(workspaceRoot, 'lambda-python'),
  serverless,
});

const computeStack = new ComputeStack(app, 'ComputeStack', {
  stackName: getStackName(environment, 'compute'),
  description: 'Disposable development Rails compute services for the aws-prueba project',
  env: stackEnvironment,
  projectName: environment.projectName,
  environmentName: environment.name,
  managedBy: 'aws-cdk',
  vpc: networkStack.vpc as IVpc,
  databaseSecret: dataStack.databaseSecret,
  databaseSecurityGroup: dataStack.databaseSecurityGroup,
  databasePort: data.postgres.port,
  valkeySecret: dataStack.valkeySecret as ISecret,
  valkeySecurityGroup: dataStack.valkeySecurityGroup,
  valkeyEndpoint: dataStack.valkeyEndpoint,
  valkeyPort: dataStack.valkeyPort,
  valkeyIngressPort: data.valkey.port,
  pythonFunction: serverlessStack.pythonFunction,
  railsSourcePath: resolve(workspaceRoot, 'api-rails'),
  compute,
});

computeStack.addStackDependency(networkStack);
computeStack.addStackDependency(dataStack);
computeStack.addStackDependency(serverlessStack);
