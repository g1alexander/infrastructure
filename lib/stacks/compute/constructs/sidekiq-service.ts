import { SecurityGroup, type IVpc } from "aws-cdk-lib/aws-ec2";
import {
  AvailabilityZoneRebalancing,
  Cluster,
  FargateService,
  type ICluster,
} from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";
import type { ComputeConfig } from "../compute-config";
import type { RailsContainerRuntime } from "./rails-container-runtime";

export interface SidekiqServiceProps {
  readonly vpc: IVpc;
  readonly cluster: Cluster;
  readonly runtime: RailsContainerRuntime;
  readonly resourceNamePrefix: string;
  readonly config: ComputeConfig;
}

export class SidekiqService extends Construct {
  public readonly securityGroup: SecurityGroup;
  public readonly service: FargateService;

  public constructor(scope: Construct, id: string, props: SidekiqServiceProps) {
    super(scope, id);

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "Outbound-only security group for the development Sidekiq service",
      allowAllOutbound: true,
    });

    const task = props.runtime.createTask("Worker", {
      workloadName: "sidekiq-worker",
      family: `${props.resourceNamePrefix}-sidekiq`,
      workload: props.config.worker,
      databasePool: props.config.worker.databasePool,
      environment: {
        SIDEKIQ_CONCURRENCY: String(props.config.worker.concurrency),
      },
      command: ["bundle", "exec", "sidekiq", "-c", String(props.config.worker.concurrency)],
    });

    this.service = new FargateService(this, "Service", {
      cluster: props.cluster as ICluster,
      taskDefinition: task.taskDefinition,
      serviceName: `${props.resourceNamePrefix}-sidekiq`,
      desiredCount: props.config.worker.desiredCount,
      assignPublicIp: false,
      vpcSubnets: { subnetType: props.config.taskSubnetType },
      securityGroups: [this.securityGroup],
      minHealthyPercent: props.config.worker.minHealthyPercent,
      maxHealthyPercent: props.config.worker.maxHealthyPercent,
      availabilityZoneRebalancing: AvailabilityZoneRebalancing.DISABLED,
      circuitBreaker: { rollback: true },
    });
  }
}
