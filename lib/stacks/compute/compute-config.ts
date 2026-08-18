import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { CpuArchitecture, OperatingSystemFamily } from "aws-cdk-lib/aws-ecs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { EnvironmentName } from "../../config/environments";

export interface ComputeWorkloadConfig {
  readonly cpu: 256;
  readonly memoryLimitMiB: 512;
}

export interface ComputeServiceConfig extends ComputeWorkloadConfig {
  readonly desiredCount: 1;
  readonly minHealthyPercent: 0;
  readonly maxHealthyPercent: 100;
}

export interface ComputeApiDnsConfig {
  readonly zoneName: string;
  readonly recordName: string;
  readonly domainName: string;
}

export interface ComputeConfig {
  readonly web: ComputeServiceConfig & {
    readonly maxThreads: number;
    readonly databasePool: number;
  };
  readonly worker: ComputeServiceConfig & {
    readonly concurrency: number;
    readonly databasePool: number;
  };
  readonly migration: ComputeWorkloadConfig & {
    readonly databasePool: number;
  };
  readonly containerPort: 3000;
  readonly albHttpPort: 80;
  readonly albHttpsPort: 443;
  readonly apiDns: ComputeApiDnsConfig;
  readonly healthEndpoint: "/up";
  readonly healthCheckGracePeriod: Duration;
  readonly taskSubnetType: SubnetType.PRIVATE_WITH_EGRESS;
  readonly albSubnetType: SubnetType.PUBLIC;
  readonly cpuArchitecture: CpuArchitecture;
  readonly operatingSystemFamily: OperatingSystemFamily;
  readonly imagePlatform: Platform;
  readonly logRetention: RetentionDays.ONE_DAY;
  readonly removalPolicy: RemovalPolicy.DESTROY;
  readonly railsSecretLength: number;
}

const apiZoneName = "chess-mentor.com";
const apiRecordName = "api-dev";
const apiDomainName = `${apiRecordName}.${apiZoneName}`;

const computeConfigs = {
  dev: {
    web: {
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      maxThreads: 2,
      databasePool: 3,
    },
    worker: {
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 1,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      concurrency: 2,
      databasePool: 3,
    },
    migration: {
      cpu: 256,
      memoryLimitMiB: 512,
      databasePool: 2,
    },
    containerPort: 3000,
    albHttpPort: 80,
    albHttpsPort: 443,
    apiDns: {
      zoneName: apiZoneName,
      recordName: apiRecordName,
      domainName: apiDomainName,
    },
    healthEndpoint: "/up",
    healthCheckGracePeriod: Duration.seconds(90),
    taskSubnetType: SubnetType.PRIVATE_WITH_EGRESS,
    albSubnetType: SubnetType.PUBLIC,
    cpuArchitecture: CpuArchitecture.ARM64,
    operatingSystemFamily: OperatingSystemFamily.LINUX,
    imagePlatform: Platform.LINUX_ARM64,
    logRetention: RetentionDays.ONE_DAY,
    removalPolicy: RemovalPolicy.DESTROY,
    railsSecretLength: 128,
  },
} as const satisfies Record<EnvironmentName, ComputeConfig>;

export function getComputeConfig(environmentName: EnvironmentName): ComputeConfig {
  const config = computeConfigs[environmentName];
  validateApiDnsConfig(config.apiDns);
  return config;
}

function validateApiDnsConfig(config: ComputeApiDnsConfig): void {
  const expectedDomainName = `${config.recordName}.${config.zoneName}`;
  const isValidLabel = (label: string): boolean =>
    /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label);
  const zoneLabels = config.zoneName.split(".");

  if (
    config.zoneName.length > 253 ||
    zoneLabels.length < 2 ||
    !zoneLabels.every(isValidLabel)
  ) {
    throw new Error(`Invalid public hosted zone name: ${config.zoneName}`);
  }
  if (!isValidLabel(config.recordName)) {
    throw new Error(`Invalid API DNS record name: ${config.recordName}`);
  }
  if (config.domainName !== expectedDomainName) {
    throw new Error(
      `API domain ${config.domainName} must equal ${config.recordName}.${config.zoneName}`,
    );
  }
}
