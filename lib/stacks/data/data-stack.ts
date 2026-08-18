import { CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { type IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { CfnReplicationGroup } from "aws-cdk-lib/aws-elasticache";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";
import { type ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { EnvironmentName } from "../../config/environments";
import { Postgres } from "./constructs/postgres";
import { Valkey } from "./constructs/valkey";
import type { DataConfig } from "./data-config";

export interface DataStackProps extends StackProps {
  readonly projectName: string;
  readonly environmentName: EnvironmentName;
  readonly managedBy: string;
  readonly vpc: IVpc;
  readonly data: DataConfig;
}

export class DataStack extends Stack {
  public readonly database: DatabaseInstance;
  public readonly databaseSecret: ISecret;
  public readonly databaseSecurityGroup: SecurityGroup;
  public readonly databaseEndpoint: string;
  public readonly databasePort: string;
  public readonly valkeyReplicationGroup: CfnReplicationGroup;
  public readonly valkeySecret: Secret;
  public readonly valkeySecurityGroup: SecurityGroup;
  public readonly valkeyEndpoint: string;
  public readonly valkeyPort: string;

  public constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    Tags.of(this).add("Project", props.projectName);
    Tags.of(this).add("Environment", props.environmentName);
    Tags.of(this).add("ManagedBy", props.managedBy);

    const postgres = new Postgres(this, "Postgres", {
      vpc: props.vpc,
      config: props.data.postgres,
    });
    const valkey = new Valkey(this, "Valkey", {
      vpc: props.vpc,
      config: props.data.valkey,
    });

    this.database = postgres.database;
    this.databaseSecret = postgres.secret;
    this.databaseSecurityGroup = postgres.securityGroup;
    this.databaseEndpoint = postgres.endpoint;
    this.databasePort = postgres.port;
    this.valkeyReplicationGroup = valkey.replicationGroup;
    this.valkeySecret = valkey.secret;
    this.valkeySecurityGroup = valkey.securityGroup;
    this.valkeyEndpoint = valkey.endpoint;
    this.valkeyPort = valkey.port;

    new CfnOutput(this, "DatabaseEndpoint", {
      description: "PostgreSQL endpoint address",
      value: this.databaseEndpoint,
    });
    new CfnOutput(this, "DatabasePort", {
      description: "PostgreSQL endpoint port",
      value: this.databasePort,
    });
    new CfnOutput(this, "DatabaseSecretArn", {
      description: "PostgreSQL credentials secret ARN",
      value: this.databaseSecret.secretArn,
    });
    new CfnOutput(this, "DatabaseSecurityGroupId", {
      description: "PostgreSQL security group ID",
      value: this.databaseSecurityGroup.securityGroupId,
    });
    new CfnOutput(this, "ValkeyEndpoint", {
      description: "Valkey primary endpoint address",
      value: this.valkeyEndpoint,
    });
    new CfnOutput(this, "ValkeyPort", {
      description: "Valkey primary endpoint port",
      value: this.valkeyPort,
    });
    new CfnOutput(this, "ValkeySecretArn", {
      description: "Valkey authentication token secret ARN",
      value: this.valkeySecret.secretArn,
    });
    new CfnOutput(this, "ValkeySecurityGroupId", {
      description: "Valkey security group ID",
      value: this.valkeySecurityGroup.securityGroupId,
    });
  }
}
