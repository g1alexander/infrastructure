import { CfnOutput, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { HttpApi, HttpStage } from "aws-cdk-lib/aws-apigatewayv2";
import { Function } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import type { EnvironmentName } from "../../config/environments";
import { getResourceName } from "../../config/naming";
import { JavaScriptApi } from "./constructs/javascript-api";
import { PythonAnalyzer } from "./constructs/python-analyzer";
import type { ServerlessConfig } from "./serverless-config";

export interface ServerlessStackProps extends StackProps {
  readonly projectName: string;
  readonly environmentName: EnvironmentName;
  readonly managedBy: string;
  readonly javascriptSourcePath: string;
  readonly pythonSourcePath: string;
  readonly serverless: ServerlessConfig;
}

export class ServerlessStack extends Stack {
  public readonly javascriptFunction: Function;
  public readonly httpApi: HttpApi;
  public readonly httpApiStage: HttpStage;
  public readonly pythonFunction: Function;

  public constructor(scope: Construct, id: string, props: ServerlessStackProps) {
    super(scope, id, props);

    Tags.of(this).add("Project", props.projectName);
    Tags.of(this).add("Environment", props.environmentName);
    Tags.of(this).add("ManagedBy", props.managedBy);

    const namingIdentity = {
      projectName: props.projectName,
      name: props.environmentName,
    };
    const javascriptFunctionName = getResourceName(namingIdentity, "javascript-api");
    const httpApiName = getResourceName(namingIdentity, "hello-api");
    const pythonFunctionName = getResourceName(namingIdentity, "python-analyzer");

    const javascriptApi = new JavaScriptApi(this, "JavaScriptApi", {
      sourcePath: props.javascriptSourcePath,
      functionName: javascriptFunctionName,
      apiName: httpApiName,
      functionLogGroupName: `/aws/lambda/${javascriptFunctionName}`,
      accessLogGroupName: `/aws/apigateway/${httpApiName}`,
      config: props.serverless.javascriptApi,
    });
    const pythonAnalyzer = new PythonAnalyzer(this, "PythonAnalyzer", {
      sourcePath: props.pythonSourcePath,
      functionName: pythonFunctionName,
      logGroupName: `/aws/lambda/${pythonFunctionName}`,
      config: props.serverless.pythonAnalyzer,
    });

    this.javascriptFunction = javascriptApi.function;
    this.httpApi = javascriptApi.api;
    this.httpApiStage = javascriptApi.stage;
    this.pythonFunction = pythonAnalyzer.function;

    new CfnOutput(this, "ApiEndpoint", {
      description: "Development hello HTTP API endpoint",
      value: this.httpApi.apiEndpoint,
    });
    new CfnOutput(this, "HelloRoute", {
      description: "Public GET hello route",
      value: `${this.httpApi.apiEndpoint}${props.serverless.javascriptApi.route.path}`,
    });
    new CfnOutput(this, "JavaScriptFunctionName", {
      description: "JavaScript hello function name",
      value: this.javascriptFunction.functionName,
    });
    new CfnOutput(this, "JavaScriptFunctionArn", {
      description: "JavaScript hello function ARN",
      value: this.javascriptFunction.functionArn,
    });
    new CfnOutput(this, "PythonFunctionName", {
      description: "Python analyzer function name",
      value: this.pythonFunction.functionName,
    });
    new CfnOutput(this, "PythonFunctionArn", {
      description: "Python analyzer function ARN",
      value: this.pythonFunction.functionArn,
    });
  }
}
