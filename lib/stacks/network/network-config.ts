import { SubnetType } from "aws-cdk-lib/aws-ec2";
import type { EnvironmentName } from "../../config/environments";

export interface NetworkSubnetConfig {
  readonly name: string;
  readonly subnetType: SubnetType;
  readonly cidrMask: number;
}

export interface NetworkConfig {
  readonly ipv4Cidr: string;
  readonly maxAzs: number;
  readonly natGateways: number;
  readonly subnetConfiguration: readonly NetworkSubnetConfig[];
}

const networkConfigs = {
  dev: {
    ipv4Cidr: "10.0.0.0/16",
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      {
        name: "public",
        subnetType: SubnetType.PUBLIC,
        cidrMask: 24,
      },
      {
        name: "private-with-egress",
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24,
      },
      {
        name: "private-isolated",
        subnetType: SubnetType.PRIVATE_ISOLATED,
        cidrMask: 24,
      },
    ],
  },
} as const satisfies Record<EnvironmentName, NetworkConfig>;

export function getNetworkConfig(environmentName: EnvironmentName): NetworkConfig {
  return networkConfigs[environmentName];
}
