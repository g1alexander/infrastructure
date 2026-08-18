import { SecurityGroup, type IVpc } from "aws-cdk-lib/aws-ec2";
import { FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";
import type { ComputeConfig } from "../compute-config";
import type { RailsContainerRuntime } from "./rails-container-runtime";

export interface MigrationTaskProps {
  readonly vpc: IVpc;
  readonly runtime: RailsContainerRuntime;
  readonly resourceNamePrefix: string;
  readonly config: ComputeConfig;
}

export class MigrationTask extends Construct {
  public readonly securityGroup: SecurityGroup;
  public readonly taskDefinition: FargateTaskDefinition;

  public constructor(scope: Construct, id: string, props: MigrationTaskProps) {
    super(scope, id);

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "Outbound-only security group for one-off development Rails migrations",
      allowAllOutbound: true,
    });

    const task = props.runtime.createTask("Migration", {
      workloadName: "rails-migration",
      family: `${props.resourceNamePrefix}-rails-migration`,
      workload: props.config.migration,
      databasePool: props.config.migration.databasePool,
      command: ["bin/rails", "db:prepare"],
    });
    this.taskDefinition = task.taskDefinition;
  }
}
