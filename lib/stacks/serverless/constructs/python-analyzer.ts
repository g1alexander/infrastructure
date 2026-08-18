import { IgnoreMode } from "aws-cdk-lib";
import { Code, Function } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import type { PythonAnalyzerConfig } from "../serverless-config";

export interface PythonAnalyzerProps {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly logGroupName: string;
  readonly config: PythonAnalyzerConfig;
}

export class PythonAnalyzer extends Construct {
  public readonly function: Function;

  public constructor(scope: Construct, id: string, props: PythonAnalyzerProps) {
    super(scope, id);

    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: props.logGroupName,
      retention: props.config.logRetention,
      removalPolicy: props.config.removalPolicy,
    });

    this.function = new Function(this, "Function", {
      functionName: props.functionName,
      description: "Performs synchronous development text analysis",
      runtime: props.config.runtime,
      architecture: props.config.architecture,
      memorySize: props.config.memorySizeMiB,
      timeout: props.config.timeout,
      handler: props.config.handler,
      code: Code.fromAsset(props.sourcePath, {
        exclude: [".git/**", ".gitignore", "README*"],
        ignoreMode: IgnoreMode.GLOB,
      }),
      logGroup,
    });
  }
}
