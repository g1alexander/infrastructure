import { Duration } from "aws-cdk-lib";
import { Peer, Port, SecurityGroup, type IVpc } from "aws-cdk-lib/aws-ec2";
import {
  AvailabilityZoneRebalancing,
  Cluster,
  FargateService,
  type ICluster,
  Protocol as EcsProtocol,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  Protocol as ElbProtocol,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import type { Function } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import type { ComputeConfig } from "../compute-config";
import type { RailsContainerRuntime } from "./rails-container-runtime";

export interface WebServiceProps {
  readonly vpc: IVpc;
  readonly cluster: Cluster;
  readonly runtime: RailsContainerRuntime;
  readonly pythonFunction: Function;
  readonly resourceNamePrefix: string;
  readonly config: ComputeConfig;
}

export class WebService extends Construct {
  public readonly loadBalancer: ApplicationLoadBalancer;
  public readonly loadBalancerSecurityGroup: SecurityGroup;
  public readonly securityGroup: SecurityGroup;
  public readonly service: FargateService;
  public readonly targetGroup: ApplicationTargetGroup;

  public constructor(scope: Construct, id: string, props: WebServiceProps) {
    super(scope, id);

    this.loadBalancerSecurityGroup = new SecurityGroup(this, "LoadBalancerSecurityGroup", {
      vpc: props.vpc,
      description: "Allows public HTTP traffic to the development Rails load balancer",
      allowAllOutbound: true,
    });
    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(props.config.albHttpPort),
      "Public HTTP",
    );

    this.securityGroup = new SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "Allows Rails web traffic only from the application load balancer",
      allowAllOutbound: true,
    });
    this.securityGroup.addIngressRule(
      this.loadBalancerSecurityGroup,
      Port.tcp(props.config.containerPort),
      "Rails web traffic from the load balancer",
    );

    const task = props.runtime.createTask("Web", {
      workloadName: "rails-web",
      family: `${props.resourceNamePrefix}-rails-web`,
      workload: props.config.web,
      databasePool: props.config.web.databasePool,
      environment: {
        RAILS_MAX_THREADS: String(props.config.web.maxThreads),
        LAMBDA_FUNCTION_NAME: props.pythonFunction.functionName,
      },
      portMappings: [
        {
          containerPort: props.config.containerPort,
          protocol: EcsProtocol.TCP,
        },
      ],
    });
    props.pythonFunction.grantInvoke(task.taskDefinition.taskRole);

    this.service = new FargateService(this, "Service", {
      cluster: props.cluster as ICluster,
      taskDefinition: task.taskDefinition,
      serviceName: `${props.resourceNamePrefix}-rails-web`,
      desiredCount: props.config.web.desiredCount,
      assignPublicIp: false,
      vpcSubnets: { subnetType: props.config.taskSubnetType },
      securityGroups: [this.securityGroup],
      minHealthyPercent: props.config.web.minHealthyPercent,
      maxHealthyPercent: props.config.web.maxHealthyPercent,
      availabilityZoneRebalancing: AvailabilityZoneRebalancing.DISABLED,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: props.config.healthCheckGracePeriod,
    });

    this.targetGroup = new ApplicationTargetGroup(this, "TargetGroup", {
      vpc: props.vpc,
      targetGroupName: `${props.resourceNamePrefix}-rails-web`,
      targetType: TargetType.IP,
      protocol: ApplicationProtocol.HTTP,
      port: props.config.containerPort,
      targets: [this.service],
      healthCheck: {
        path: props.config.healthEndpoint,
        protocol: ElbProtocol.HTTP,
        healthyHttpCodes: "200-399",
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    this.loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: props.vpc,
      loadBalancerName: `${props.resourceNamePrefix}-rails-alb`,
      internetFacing: true,
      vpcSubnets: { subnetType: props.config.albSubnetType },
      securityGroup: this.loadBalancerSecurityGroup,
      deletionProtection: false,
      dropInvalidHeaderFields: true,
    });
    this.loadBalancer.addListener("HttpListener", {
      port: props.config.albHttpPort,
      protocol: ApplicationProtocol.HTTP,
      open: false,
      defaultTargetGroups: [this.targetGroup],
    });
  }
}
