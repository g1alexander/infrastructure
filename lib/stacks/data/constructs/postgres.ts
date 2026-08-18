import { RemovalPolicy } from "aws-cdk-lib";
import { type IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
} from "aws-cdk-lib/aws-rds";
import type { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { PostgresConfig } from "../data-config";

export interface PostgresProps {
  readonly vpc: IVpc;
  readonly config: PostgresConfig;
}

export class Postgres extends Construct {
  public readonly database: DatabaseInstance;
  public readonly secret: ISecret;
  public readonly securityGroup: SecurityGroup;
  public readonly endpoint: string;
  public readonly port: string;

  public constructor(scope: Construct, id: string, props: PostgresProps) {
    super(scope, id);

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "Security group for the development PostgreSQL database; ingress is managed by clients",
      allowAllOutbound: false,
    });

    this.database = new DatabaseInstance(this, "Database", {
      engine: DatabaseInstanceEngine.postgres({ version: props.config.engineVersion }),
      credentials: Credentials.fromGeneratedSecret(props.config.adminUsername),
      databaseName: props.config.databaseName,
      instanceType: props.config.instanceType,
      vpc: props.vpc,
      vpcSubnets: { subnetType: props.config.subnetType },
      securityGroups: [this.securityGroup],
      port: props.config.port,
      multiAz: props.config.multiAz,
      publiclyAccessible: props.config.publiclyAccessible,
      allocatedStorage: props.config.allocatedStorageGiB,
      storageType: props.config.storageType,
      storageEncrypted: props.config.storageEncrypted,
      autoMinorVersionUpgrade: props.config.autoMinorVersionUpgrade,
      enablePerformanceInsights: props.config.enablePerformanceInsights,
      backupRetention: props.config.backupRetention,
      deleteAutomatedBackups: props.config.deleteAutomatedBackups,
      deletionProtection: props.config.deletionProtection,
      removalPolicy: props.config.removalPolicy,
    });

    const generatedSecret = this.database.secret;
    if (!generatedSecret) {
      throw new Error("PostgreSQL generated credentials secret was not created");
    }

    generatedSecret.applyRemovalPolicy(RemovalPolicy.DESTROY);
    this.secret = generatedSecret;
    this.endpoint = this.database.dbInstanceEndpointAddress;
    this.port = this.database.dbInstanceEndpointPort;
  }
}
