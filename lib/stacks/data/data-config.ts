import { Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
import { PostgresEngineVersion, StorageType } from "aws-cdk-lib/aws-rds";
import type { EnvironmentName } from "../../config/environments";

export interface PostgresConfig {
  readonly engineVersion: PostgresEngineVersion;
  readonly instanceType: InstanceType;
  readonly allocatedStorageGiB: number;
  readonly storageType: StorageType;
  readonly databaseName: string;
  readonly adminUsername: string;
  readonly port: number;
  readonly subnetType: SubnetType;
  readonly multiAz: boolean;
  readonly publiclyAccessible: boolean;
  readonly storageEncrypted: boolean;
  readonly autoMinorVersionUpgrade: boolean;
  readonly enablePerformanceInsights: boolean;
  readonly backupRetention: Duration;
  readonly deleteAutomatedBackups: boolean;
  readonly deletionProtection: boolean;
  readonly removalPolicy: RemovalPolicy;
}

export interface ValkeyConfig {
  readonly engine: "valkey";
  readonly engineVersion: "8.2";
  readonly nodeType: "cache.t4g.micro";
  readonly port: number;
  readonly subnetType: SubnetType;
  readonly numCacheClusters: 1;
  readonly clusterMode: "disabled";
  readonly automaticFailoverEnabled: false;
  readonly multiAzEnabled: false;
  readonly transitEncryptionEnabled: true;
  readonly atRestEncryptionEnabled: true;
  readonly snapshotRetentionLimit: 0;
  readonly authTokenLength: number;
  readonly removalPolicy: RemovalPolicy;
}

export interface DataConfig {
  readonly postgres: PostgresConfig;
  readonly valkey: ValkeyConfig;
}

const dataConfigs = {
  dev: {
    postgres: {
      engineVersion: PostgresEngineVersion.VER_16,
      instanceType: InstanceType.of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MICRO),
      allocatedStorageGiB: 20,
      storageType: StorageType.GP3,
      databaseName: "api_rails_dev",
      adminUsername: "app_admin",
      port: 5432,
      subnetType: SubnetType.PRIVATE_ISOLATED,
      multiAz: false,
      publiclyAccessible: false,
      storageEncrypted: true,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: false,
      backupRetention: Duration.days(0),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    },
    valkey: {
      engine: "valkey",
      engineVersion: "8.2",
      nodeType: "cache.t4g.micro",
      port: 6379,
      subnetType: SubnetType.PRIVATE_ISOLATED,
      numCacheClusters: 1,
      clusterMode: "disabled",
      automaticFailoverEnabled: false,
      multiAzEnabled: false,
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      snapshotRetentionLimit: 0,
      authTokenLength: 64,
      removalPolicy: RemovalPolicy.DESTROY,
    },
  },
} as const satisfies Record<EnvironmentName, DataConfig>;

export function getDataConfig(environmentName: EnvironmentName): DataConfig {
  return dataConfigs[environmentName];
}
