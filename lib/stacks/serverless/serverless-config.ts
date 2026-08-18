import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import type { EnvironmentName } from "../../config/environments";

export interface FunctionConfig {
  readonly runtime: Runtime;
  readonly architecture: Architecture;
  readonly memorySizeMiB: number;
  readonly timeout: Duration;
  readonly logRetention: RetentionDays;
  readonly removalPolicy: RemovalPolicy;
}

export interface JavaScriptApiConfig extends FunctionConfig {
  readonly handler: "index.handler";
  readonly route: {
    readonly method: HttpMethod.GET;
    readonly path: "/hello";
  };
  readonly throttle: {
    readonly rateLimit: number;
    readonly burstLimit: number;
  };
  readonly accessLogRetention: RetentionDays;
}

export interface PythonAnalyzerConfig extends FunctionConfig {
  readonly handler: "lambda_function.lambda_handler";
}

export interface ServerlessConfig {
  readonly javascriptApi: JavaScriptApiConfig;
  readonly pythonAnalyzer: PythonAnalyzerConfig;
}

const serverlessConfigs = {
  dev: {
    javascriptApi: {
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySizeMiB: 128,
      timeout: Duration.seconds(10),
      handler: "index.handler",
      route: {
        method: HttpMethod.GET,
        path: "/hello",
      },
      throttle: {
        rateLimit: 2,
        burstLimit: 5,
      },
      logRetention: RetentionDays.ONE_DAY,
      accessLogRetention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    },
    pythonAnalyzer: {
      runtime: Runtime.PYTHON_3_14,
      architecture: Architecture.ARM_64,
      memorySizeMiB: 128,
      timeout: Duration.seconds(10),
      handler: "lambda_function.lambda_handler",
      logRetention: RetentionDays.ONE_DAY,
      removalPolicy: RemovalPolicy.DESTROY,
    },
  },
} as const satisfies Record<EnvironmentName, ServerlessConfig>;

export function getServerlessConfig(environmentName: EnvironmentName): ServerlessConfig {
  return serverlessConfigs[environmentName];
}
