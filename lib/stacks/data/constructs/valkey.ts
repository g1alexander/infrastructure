import { RemovalPolicy } from "aws-cdk-lib";
import { type IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { CfnReplicationGroup, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { ValkeyConfig } from "../data-config";

export interface ValkeyProps {
  readonly vpc: IVpc;
  readonly config: ValkeyConfig;
}

export class Valkey extends Construct {
  public readonly replicationGroup: CfnReplicationGroup;
  public readonly secret: Secret;
  public readonly securityGroup: SecurityGroup;
  public readonly subnetGroup: CfnSubnetGroup;
  public readonly endpoint: string;
  public readonly port: string;

  public constructor(scope: Construct, id: string, props: ValkeyProps) {
    super(scope, id);

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "Security group for the development Valkey cache; ingress is managed by clients",
      allowAllOutbound: false,
    });

    this.subnetGroup = new CfnSubnetGroup(this, "SubnetGroup", {
      description: "Private isolated subnets for the development Valkey cache",
      subnetIds: props.vpc.selectSubnets({ subnetType: props.config.subnetType }).subnetIds,
    });
    this.subnetGroup.applyRemovalPolicy(props.config.removalPolicy);

    this.secret = new Secret(this, "AuthTokenSecret", {
      description: "Authentication token for the development Valkey cache",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: "authToken",
        passwordLength: props.config.authTokenLength,
        excludePunctuation: true,
        includeSpace: false,
        requireEachIncludedType: true,
      },
      removalPolicy: props.config.removalPolicy,
    });

    this.replicationGroup = new CfnReplicationGroup(this, "ReplicationGroup", {
      replicationGroupDescription: "Disposable development Valkey cache for aws-prueba",
      engine: props.config.engine,
      engineVersion: props.config.engineVersion,
      cacheNodeType: props.config.nodeType,
      port: props.config.port,
      numCacheClusters: props.config.numCacheClusters,
      clusterMode: props.config.clusterMode,
      automaticFailoverEnabled: props.config.automaticFailoverEnabled,
      multiAzEnabled: props.config.multiAzEnabled,
      transitEncryptionEnabled: props.config.transitEncryptionEnabled,
      transitEncryptionMode: "required",
      atRestEncryptionEnabled: props.config.atRestEncryptionEnabled,
      snapshotRetentionLimit: props.config.snapshotRetentionLimit,
      cacheSubnetGroupName: this.subnetGroup.ref,
      securityGroupIds: [this.securityGroup.securityGroupId],
      authToken: this.secret.secretValueFromJson("authToken").unsafeUnwrap(),
    });
    this.replicationGroup.applyRemovalPolicy(RemovalPolicy.DESTROY);

    this.endpoint = this.replicationGroup.attrPrimaryEndPointAddress;
    this.port = this.replicationGroup.attrPrimaryEndPointPort;
  }
}
