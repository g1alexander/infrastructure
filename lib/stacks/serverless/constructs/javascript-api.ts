import { IgnoreMode } from "aws-cdk-lib";
import { AccessLogFormat } from "aws-cdk-lib/aws-apigateway";
import {
  HttpApi,
  HttpStage,
  LogGroupLogDestination,
  PayloadFormatVersion,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Code, Function } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import type { JavaScriptApiConfig } from "../serverless-config";

export interface JavaScriptApiProps {
  readonly sourcePath: string;
  readonly functionName: string;
  readonly apiName: string;
  readonly functionLogGroupName: string;
  readonly accessLogGroupName: string;
  readonly config: JavaScriptApiConfig;
}

export class JavaScriptApi extends Construct {
  public readonly function: Function;
  public readonly api: HttpApi;
  public readonly stage: HttpStage;

  public constructor(scope: Construct, id: string, props: JavaScriptApiProps) {
    super(scope, id);

    const functionLogGroup = new LogGroup(this, "FunctionLogGroup", {
      logGroupName: props.functionLogGroupName,
      retention: props.config.logRetention,
      removalPolicy: props.config.removalPolicy,
    });

    this.function = new Function(this, "Function", {
      functionName: props.functionName,
      description: "Returns the development hello response",
      runtime: props.config.runtime,
      architecture: props.config.architecture,
      memorySize: props.config.memorySizeMiB,
      timeout: props.config.timeout,
      handler: props.config.handler,
      code: Code.fromAsset(props.sourcePath, {
        exclude: [".git/**", ".gitignore", "README*"],
        ignoreMode: IgnoreMode.GLOB,
      }),
      logGroup: functionLogGroup,
    });

    const accessLogGroup = new LogGroup(this, "AccessLogGroup", {
      logGroupName: props.accessLogGroupName,
      retention: props.config.accessLogRetention,
      removalPolicy: props.config.removalPolicy,
    });

    this.api = new HttpApi(this, "HttpApi", {
      apiName: props.apiName,
      description: "Public development hello HTTP API",
      createDefaultStage: false,
    });

    this.stage = new HttpStage(this, "DefaultStage", {
      httpApi: this.api,
      stageName: "$default",
      autoDeploy: true,
      throttle: props.config.throttle,
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogGroup),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: "$context.requestId",
            sourceIp: "$context.identity.sourceIp",
            requestTime: "$context.requestTime",
            httpMethod: "$context.httpMethod",
            routeKey: "$context.routeKey",
            path: "$context.path",
            status: "$context.status",
            protocol: "$context.protocol",
            responseLength: "$context.responseLength",
          }),
        ),
      },
    });

    const integration = new HttpLambdaIntegration("HelloIntegration", this.function, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.api.addRoutes({
      path: props.config.route.path,
      methods: [props.config.route.method],
      integration,
    });
  }
}
