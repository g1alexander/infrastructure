import {
  CfnOutput,
  Fn,
  Stack,
  type StackProps,
  Tags,
} from "aws-cdk-lib";
import {
  CfnSecurityGroupIngress,
  type IVpc,
  type SecurityGroup,
} from "aws-cdk-lib/aws-ec2";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import type { Function } from "aws-cdk-lib/aws-lambda";
import { Secret, type ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { EnvironmentName } from "../../config/environments";
import { getResourceName } from "../../config/naming";
import type { ComputeConfig } from "./compute-config";
import { MigrationTask } from "./constructs/migration-task";
import { RailsContainerRuntime } from "./constructs/rails-container-runtime";
import { RailsImage } from "./constructs/rails-image";
import { SidekiqService } from "./constructs/sidekiq-service";
import { WebService } from "./constructs/web-service";

export interface ComputeStackProps extends StackProps {
  readonly projectName: string;
  readonly environmentName: EnvironmentName;
  readonly managedBy: string;
  readonly vpc: IVpc;
  readonly databaseSecret: ISecret;
  readonly databaseSecurityGroup: SecurityGroup;
  readonly databasePort: number;
  readonly valkeySecret: ISecret;
  readonly valkeySecurityGroup: SecurityGroup;
  readonly valkeyEndpoint: string;
  readonly valkeyPort: string;
  readonly valkeyIngressPort: number;
  readonly pythonFunction: Function;
  readonly railsSourcePath: string;
  readonly compute: ComputeConfig;
}

export class ComputeStack extends Stack {
  public readonly cluster: Cluster;
  public readonly railsSecret: Secret;

  public constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    Tags.of(this).add("Project", props.projectName);
    Tags.of(this).add("Environment", props.environmentName);
    Tags.of(this).add("ManagedBy", props.managedBy);

    const namingIdentity = {
      projectName: props.projectName,
      name: props.environmentName,
    };
    const resourceNamePrefix = getResourceName(namingIdentity, "compute");

    this.cluster = new Cluster(this, "Cluster", {
      vpc: props.vpc,
      clusterName: getResourceName(namingIdentity, "rails"),
    });

    this.railsSecret = new Secret(this, "RailsSecretKeyBase", {
      secretName: getResourceName(namingIdentity, "rails-secret-key-base"),
      description: "Generated SECRET_KEY_BASE for the disposable development Rails environment",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: "secretKeyBase",
        passwordLength: props.compute.railsSecretLength,
        excludePunctuation: true,
        includeSpace: false,
        requireEachIncludedType: true,
      },
      removalPolicy: props.compute.removalPolicy,
    });

    const railsImage = new RailsImage(this, "RailsImage", {
      sourcePath: props.railsSourcePath,
      config: props.compute,
    });
    const runtime = new RailsContainerRuntime(this, "RailsRuntime", {
      image: railsImage.containerImage,
      databaseSecret: props.databaseSecret,
      valkeySecret: props.valkeySecret,
      railsSecret: this.railsSecret as ISecret,
      valkeyEndpoint: props.valkeyEndpoint,
      valkeyPort: props.valkeyPort,
      awsRegion: this.region,
      config: props.compute,
    });

    const web = new WebService(this, "Web", {
      vpc: props.vpc,
      cluster: this.cluster,
      runtime,
      pythonFunction: props.pythonFunction,
      resourceNamePrefix,
      config: props.compute,
    });
    const worker = new SidekiqService(this, "Sidekiq", {
      vpc: props.vpc,
      cluster: this.cluster,
      runtime,
      resourceNamePrefix,
      config: props.compute,
    });
    const migration = new MigrationTask(this, "Migration", {
      vpc: props.vpc,
      runtime,
      resourceNamePrefix,
      config: props.compute,
    });

    this.addDataIngress(
      "DatabaseWebIngress",
      props.databaseSecurityGroup,
      web.securityGroup,
      props.databasePort,
      "Rails web access to PostgreSQL",
    );
    this.addDataIngress(
      "DatabaseWorkerIngress",
      props.databaseSecurityGroup,
      worker.securityGroup,
      props.databasePort,
      "Sidekiq access to PostgreSQL",
    );
    this.addDataIngress(
      "DatabaseMigrationIngress",
      props.databaseSecurityGroup,
      migration.securityGroup,
      props.databasePort,
      "Rails migration access to PostgreSQL",
    );
    this.addDataIngress(
      "ValkeyWebIngress",
      props.valkeySecurityGroup,
      web.securityGroup,
      props.valkeyIngressPort,
      "Rails web access to Valkey",
    );
    this.addDataIngress(
      "ValkeyWorkerIngress",
      props.valkeySecurityGroup,
      worker.securityGroup,
      props.valkeyIngressPort,
      "Sidekiq access to Valkey",
    );
    this.addDataIngress(
      "ValkeyMigrationIngress",
      props.valkeySecurityGroup,
      migration.securityGroup,
      props.valkeyIngressPort,
      "Rails migration access to Valkey",
    );

    new CfnOutput(this, "ApplicationUrl", {
      description: "Development Rails HTTP endpoint",
      value: `http://${web.loadBalancer.loadBalancerDnsName}`,
    });
    new CfnOutput(this, "LoadBalancerDnsName", {
      description: "Development Rails application load balancer DNS name",
      value: web.loadBalancer.loadBalancerDnsName,
    });
    new CfnOutput(this, "ClusterName", {
      description: "ECS cluster name",
      value: this.cluster.clusterName,
    });
    new CfnOutput(this, "ClusterArn", {
      description: "ECS cluster ARN",
      value: this.cluster.clusterArn,
    });
    new CfnOutput(this, "WebServiceName", {
      description: "Rails web ECS service name",
      value: web.service.serviceName,
    });
    new CfnOutput(this, "SidekiqServiceName", {
      description: "Sidekiq ECS service name",
      value: worker.service.serviceName,
    });
    new CfnOutput(this, "MigrationTaskDefinitionArn", {
      description: "One-off Rails migration task definition ARN",
      value: migration.taskDefinition.taskDefinitionArn,
    });
    new CfnOutput(this, "MigrationSecurityGroupId", {
      description: "Security group ID for one-off Rails migration tasks",
      value: migration.securityGroup.securityGroupId,
    });
    new CfnOutput(this, "PrivateWithEgressSubnetIds", {
      description: "Private-with-egress subnet IDs for one-off Rails migration tasks",
      value: Fn.join(",", props.vpc.selectSubnets({ subnetType: props.compute.taskSubnetType }).subnetIds),
    });
    new CfnOutput(this, "RailsImageUri", {
      description: "CDK Docker image asset URI",
      value: railsImage.asset.imageUri,
    });
    new CfnOutput(this, "RailsSecretArn", {
      description: "Rails SECRET_KEY_BASE secret ARN",
      value: this.railsSecret.secretArn,
    });
  }

  private addDataIngress(
    id: string,
    destination: SecurityGroup,
    source: SecurityGroup,
    port: number,
    description: string,
  ): void {
    new CfnSecurityGroupIngress(this, id, {
      groupId: destination.securityGroupId,
      sourceSecurityGroupId: source.securityGroupId,
      ipProtocol: "tcp",
      fromPort: port,
      toPort: port,
      description,
    });
  }
}
