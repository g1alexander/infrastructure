import { ContainerImage } from "aws-cdk-lib/aws-ecs";
import { DockerImageAsset } from "aws-cdk-lib/aws-ecr-assets";
import { Construct } from "constructs";
import type { ComputeConfig } from "../compute-config";

export interface RailsImageProps {
  readonly sourcePath: string;
  readonly config: ComputeConfig;
}

export class RailsImage extends Construct {
  public readonly asset: DockerImageAsset;
  public readonly containerImage: ContainerImage;

  public constructor(scope: Construct, id: string, props: RailsImageProps) {
    super(scope, id);

    this.asset = new DockerImageAsset(this, "Asset", {
      directory: props.sourcePath,
      platform: props.config.imagePlatform,
    });
    this.containerImage = ContainerImage.fromDockerImageAsset(this.asset);
  }
}
