import { CfnOutput, Fn, Stack, StackProps, Tags } from "aws-cdk-lib";
import { IpAddresses, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import type { EnvironmentName } from "../../config/environments";
import type { NetworkConfig } from "./network-config";

export interface NetworkStackProps extends StackProps {
  readonly projectName: string;
  readonly environmentName: EnvironmentName;
  readonly managedBy: string;
  readonly network: NetworkConfig;
}

export class NetworkStack extends Stack {
  public readonly vpc: Vpc;

  public constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    Tags.of(this).add("Project", props.projectName);
    Tags.of(this).add("Environment", props.environmentName);
    Tags.of(this).add("ManagedBy", props.managedBy);

    this.vpc = new Vpc(this, "Vpc", {
      ipAddresses: IpAddresses.cidr(props.network.ipv4Cidr),
      maxAzs: props.network.maxAzs,
      natGateways: props.network.natGateways,
      enableDnsSupport: true,
      enableDnsHostnames: true,
      subnetConfiguration: props.network.subnetConfiguration.map((subnet) => ({
        name: subnet.name,
        subnetType: subnet.subnetType,
        cidrMask: subnet.cidrMask,
      })),
    });

    new CfnOutput(this, "VpcId", {
      description: "Development VPC ID",
      value: this.vpc.vpcId,
    });

    new CfnOutput(this, "PublicSubnetIds", {
      description: "Public subnet IDs",
      value: Fn.join(",", this.vpc.selectSubnets({ subnetType: SubnetType.PUBLIC }).subnetIds),
    });

    new CfnOutput(this, "PrivateWithEgressSubnetIds", {
      description: "Private-with-egress subnet IDs",
      value: Fn.join(",", this.vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds),
    });

    new CfnOutput(this, "IsolatedSubnetIds", {
      description: "Isolated subnet IDs",
      value: Fn.join(",", this.vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_ISOLATED }).subnetIds),
    });
  }
}
