import {
  ContainerImage,
  FargateTaskDefinition,
  LogDrivers,
  Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import type { ContainerDefinition, PortMapping } from "aws-cdk-lib/aws-ecs";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { ISecret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { ComputeConfig, ComputeWorkloadConfig } from "../compute-config";

export interface RailsContainerRuntimeProps {
  readonly image: ContainerImage;
  readonly databaseSecret: ISecret;
  readonly valkeySecret: ISecret;
  readonly railsSecret: ISecret;
  readonly valkeyEndpoint: string;
  readonly valkeyPort: string;
  readonly awsRegion: string;
  readonly config: ComputeConfig;
}

export interface RailsTaskOptions {
  readonly workloadName: string;
  readonly family: string;
  readonly workload: ComputeWorkloadConfig;
  readonly databasePool: number;
  readonly environment?: Readonly<Record<string, string>>;
  readonly command?: readonly string[];
  readonly portMappings?: readonly PortMapping[];
}

export interface RailsTask {
  readonly taskDefinition: FargateTaskDefinition;
  readonly container: ContainerDefinition;
  readonly logGroup: LogGroup;
}

export class RailsContainerRuntime extends Construct {
  private readonly props: RailsContainerRuntimeProps;

  public constructor(scope: Construct, id: string, props: RailsContainerRuntimeProps) {
    super(scope, id);
    this.props = props;
  }

  public createTask(id: string, options: RailsTaskOptions): RailsTask {
    const logGroup = new LogGroup(this, `${id}LogGroup`, {
      logGroupName: `/aws/ecs/${options.family}`,
      retention: this.props.config.logRetention,
      removalPolicy: this.props.config.removalPolicy,
    });
    const taskDefinition = new FargateTaskDefinition(this, `${id}TaskDefinition`, {
      family: options.family,
      cpu: options.workload.cpu,
      memoryLimitMiB: options.workload.memoryLimitMiB,
      runtimePlatform: {
        cpuArchitecture: this.props.config.cpuArchitecture,
        operatingSystemFamily: this.props.config.operatingSystemFamily,
      },
    });

    const container = taskDefinition.addContainer(`${id}Container`, {
      containerName: options.workloadName,
      image: this.props.image,
      essential: true,
      environment: {
        RAILS_ENV: "production",
        AWS_REGION: this.props.awsRegion,
        DB_SSLMODE: "require",
        DB_POOL: String(options.databasePool),
        REDIS_HOST: this.props.valkeyEndpoint,
        REDIS_PORT: this.props.valkeyPort,
        ...options.environment,
      },
      secrets: {
        DB_USERNAME: EcsSecret.fromSecretsManager(this.props.databaseSecret, "username"),
        DB_PASSWORD: EcsSecret.fromSecretsManager(this.props.databaseSecret, "password"),
        DB_HOST: EcsSecret.fromSecretsManager(this.props.databaseSecret, "host"),
        DB_PORT: EcsSecret.fromSecretsManager(this.props.databaseSecret, "port"),
        DB_NAME: EcsSecret.fromSecretsManager(this.props.databaseSecret, "dbname"),
        REDIS_PASSWORD: EcsSecret.fromSecretsManager(this.props.valkeySecret, "authToken"),
        SECRET_KEY_BASE: EcsSecret.fromSecretsManager(this.props.railsSecret, "secretKeyBase"),
      },
      logging: LogDrivers.awsLogs({
        logGroup,
        streamPrefix: options.workloadName,
      }),
      ...(options.command ? { command: [...options.command] } : {}),
      ...(options.portMappings ? { portMappings: [...options.portMappings] } : {}),
    });

    return { taskDefinition, container, logGroup };
  }
}
