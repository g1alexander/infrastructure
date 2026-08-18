import { Stack, StackProps, Tags } from "aws-cdk-lib";
import { Construct } from "constructs";
import { EnvironmentName } from "./config/environments";

export interface FoundationStackProps extends StackProps {
  readonly environmentName: EnvironmentName;
}

export class FoundationStack extends Stack {
  public constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    Tags.of(this).add("Project", "aws-prueba");
    Tags.of(this).add("Environment", props.environmentName);
    Tags.of(this).add("ManagedBy", "aws-cdk");
  }
}
