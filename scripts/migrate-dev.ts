import { spawnSync } from "node:child_process";
import { getEnvironmentConfig } from "../lib/config/environments";
import { getStackName, getResourceName } from "../lib/config/naming";

const ENVIRONMENT_NAME = "dev";
const EXPECTED_OUTPUTS = [
  "ClusterName",
  "MigrationTaskDefinitionArn",
  "MigrationSecurityGroupId",
  "PrivateWithEgressSubnetIds",
] as const;

type ExpectedOutput = (typeof EXPECTED_OUTPUTS)[number];
type JsonObject = Record<string, unknown>;

interface CommandOptions {
  readonly help: boolean;
  readonly profile?: string;
}

interface MigrationResources {
  readonly clusterName: string;
  readonly taskDefinitionArn: string;
  readonly securityGroupId: string;
  readonly subnetIds: readonly string[];
}

interface AwsContext {
  readonly profile: string;
  readonly region: string;
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const environment = getEnvironmentConfig(ENVIRONMENT_NAME);
  const profile = options.profile ?? `${environment.projectName}-${environment.name}`;
  validateProfile(profile);

  const awsContext = { profile, region: environment.region };
  const stackName = getStackName(environment, "compute");
  const startedBy = getResourceName(environment, "migration");

  console.log(`Reading migration configuration from CloudFormation stack ${stackName}.`);
  const resources = readMigrationResources(stackName, awsContext);
  const taskFamily = getTaskDefinitionFamily(resources.taskDefinitionArn);

  ensureNoActiveMigration(resources.clusterName, taskFamily, awsContext);

  const taskArn = launchMigration(resources, startedBy, awsContext);
  waitForMigration(resources.clusterName, taskArn, awsContext);
  const exitCode = describeMigrationResult(resources.clusterName, taskArn, awsContext);

  if (exitCode !== 0) {
    throw new Error(
      `Migration container exited with code ${exitCode}. Check its ECS logs before continuing.`,
    );
  }

  console.log("Migration completed successfully.");
}

function parseArguments(args: readonly string[]): CommandOptions {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  let profile: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }

    if (argument === "--profile") {
      if (profile !== undefined) {
        throw new Error("The --profile option may only be provided once.");
      }

      const value = args[index + 1];
      if (value === undefined || value === "--" || value.startsWith("--")) {
        throw new Error("The --profile option requires a profile name.");
      }

      profile = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${String(argument)}. Run with --help for usage.`);
  }

  return profile === undefined ? { help: false } : { help: false, profile };
}

function printHelp(): void {
  console.log(`Run the development ECS migration task and verify its exit code.

Usage:
  pnpm migrate:dev
  pnpm migrate:dev -- --profile <name>

Options:
  --profile <name>  AWS profile to use (default: aws-prueba-dev)
  -h, --help        Show this help without invoking AWS

This command only runs the one-off migration task. It does not deploy services or run health checks.`);
}

function validateProfile(profile: string): void {
  if (profile.trim().length === 0 || /[\r\n\0]/u.test(profile)) {
    throw new Error("The AWS profile name must be a non-empty single-line value.");
  }
}

function readMigrationResources(stackName: string, context: AwsContext): MigrationResources {
  const response = runAwsJson(
    ["cloudformation", "describe-stacks", "--stack-name", stackName],
    context,
    `Could not read CloudFormation stack ${stackName}`,
  );
  const responseObject = requireObject(response, "CloudFormation response");
  const stacks = requireArray(responseObject.Stacks, "CloudFormation Stacks");

  if (stacks.length !== 1) {
    throw new Error(
      `CloudFormation stack ${stackName} was not found or returned an unexpected result. Deploy the ComputeStack first.`,
    );
  }

  const stack = requireObject(stacks[0], "CloudFormation stack");
  const outputs = requireArray(stack.Outputs, `CloudFormation outputs for ${stackName}`);
  const outputValues = new Map<string, string>();

  for (const output of outputs) {
    const outputObject = requireObject(output, "CloudFormation output");
    if (typeof outputObject.OutputKey === "string" && typeof outputObject.OutputValue === "string") {
      outputValues.set(outputObject.OutputKey, outputObject.OutputValue);
    }
  }

  const missingOutputs = EXPECTED_OUTPUTS.filter((key) => !getNonEmptyValue(outputValues, key));
  if (missingOutputs.length > 0) {
    throw new Error(
      `CloudFormation stack ${stackName} is missing required output(s): ${missingOutputs.join(
        ", ",
      )}. Deploy the current ComputeStack before running migrations.`,
    );
  }

  const subnetIds = parseSubnetIds(requireOutput(outputValues, "PrivateWithEgressSubnetIds"));
  const securityGroupId = requireOutput(outputValues, "MigrationSecurityGroupId");
  if (!/^sg-[a-z0-9]+$/iu.test(securityGroupId)) {
    throw new Error("MigrationSecurityGroupId is not a valid security group ID.");
  }

  return {
    clusterName: requireOutput(outputValues, "ClusterName"),
    taskDefinitionArn: requireOutput(outputValues, "MigrationTaskDefinitionArn"),
    securityGroupId,
    subnetIds,
  };
}

function getNonEmptyValue(outputs: ReadonlyMap<string, string>, key: ExpectedOutput): string | undefined {
  const value = outputs.get(key)?.trim();
  return value && value.length > 0 ? value : undefined;
}

function requireOutput(outputs: ReadonlyMap<string, string>, key: ExpectedOutput): string {
  const value = getNonEmptyValue(outputs, key);
  if (value === undefined) {
    throw new Error(`Required CloudFormation output ${key} is missing or empty.`);
  }
  return value;
}

function parseSubnetIds(value: string): readonly string[] {
  const rawSubnetIds = value.split(",");
  const subnetIds = rawSubnetIds.map((subnetId) => subnetId.trim());

  if (
    subnetIds.length === 0 ||
    subnetIds.some((subnetId) => subnetId.length === 0 || !/^subnet-[a-z0-9]+$/iu.test(subnetId))
  ) {
    throw new Error(
      "PrivateWithEgressSubnetIds must contain a comma-separated list of valid subnet IDs.",
    );
  }

  return [...new Set(subnetIds)];
}

function getTaskDefinitionFamily(taskDefinitionArn: string): string {
  const resourceSeparator = taskDefinitionArn.lastIndexOf("/");
  const revisionSeparator = taskDefinitionArn.lastIndexOf(":");
  if (resourceSeparator < 0 || revisionSeparator <= resourceSeparator + 1) {
    throw new Error("MigrationTaskDefinitionArn is not a revisioned ECS task definition ARN.");
  }

  const family = taskDefinitionArn.slice(resourceSeparator + 1, revisionSeparator);
  const revision = taskDefinitionArn.slice(revisionSeparator + 1);
  if (!/^[a-z0-9_-]{1,255}$/iu.test(family) || !/^\d+$/u.test(revision)) {
    throw new Error("MigrationTaskDefinitionArn does not contain a valid family and revision.");
  }

  return family;
}

function ensureNoActiveMigration(
  clusterName: string,
  taskFamily: string,
  context: AwsContext,
): void {
  console.log(`Checking for an active migration task in family ${taskFamily}.`);

  // ECS tasks whose lastStatus is PENDING still have desiredStatus RUNNING.
  const response = runAwsJson(
    [
      "ecs",
      "list-tasks",
      "--cluster",
      clusterName,
      "--family",
      taskFamily,
      "--desired-status",
      "RUNNING",
    ],
    context,
    "Could not check for an existing PENDING or RUNNING migration task",
  );
  const responseObject = requireObject(response, "ECS list-tasks response");
  const taskArns = requireStringArray(responseObject.taskArns, "ECS taskArns");

  if (taskArns.length > 0) {
    throw new Error(
      `An existing migration task is PENDING or RUNNING for family ${taskFamily}: ${taskArns[0]}. Wait for it to stop before trying again.`,
    );
  }
}

function launchMigration(
  resources: MigrationResources,
  startedBy: string,
  context: AwsContext,
): string {
  const networkConfiguration = JSON.stringify({
    awsvpcConfiguration: {
      subnets: resources.subnetIds,
      securityGroups: [resources.securityGroupId],
      assignPublicIp: "DISABLED",
    },
  });

  console.log("Launching one Fargate migration task in private subnets.");
  const response = runAwsJson(
    [
      "ecs",
      "run-task",
      "--cluster",
      resources.clusterName,
      "--task-definition",
      resources.taskDefinitionArn,
      "--launch-type",
      "FARGATE",
      "--count",
      "1",
      "--started-by",
      startedBy,
      "--network-configuration",
      networkConfiguration,
    ],
    context,
    "ECS run-task failed before returning a migration task",
  );
  const responseObject = requireObject(response, "ECS run-task response");
  const failures = requireArray(responseObject.failures, "ECS run-task failures");

  if (failures.length > 0) {
    throw new Error(`ECS rejected the migration task: ${formatEcsFailures(failures)}. No retry was attempted.`);
  }

  const tasks = requireArray(responseObject.tasks, "ECS run-task tasks");
  if (tasks.length !== 1) {
    throw new Error(
      `ECS run-task returned ${tasks.length} tasks instead of exactly one. No retry was attempted.`,
    );
  }

  const task = requireObject(tasks[0], "ECS run-task task");
  if (typeof task.taskArn !== "string" || task.taskArn.trim().length === 0) {
    throw new Error("ECS run-task returned no task ARN. No retry was attempted.");
  }

  console.log(`Migration task launched: ${task.taskArn}`);
  return task.taskArn;
}

function waitForMigration(clusterName: string, taskArn: string, context: AwsContext): void {
  console.log("Waiting for the migration task to stop.");
  runAws(
    ["ecs", "wait", "tasks-stopped", "--cluster", clusterName, "--tasks", taskArn],
    context,
    `ECS waiter failed for task ${taskArn}. The task may still be running; inspect it before retrying`,
  );
}

function describeMigrationResult(
  clusterName: string,
  taskArn: string,
  context: AwsContext,
): number {
  const response = runAwsJson(
    ["ecs", "describe-tasks", "--cluster", clusterName, "--tasks", taskArn],
    context,
    `Could not read the stopped migration task ${taskArn}`,
  );
  const responseObject = requireObject(response, "ECS describe-tasks response");
  const failures = requireArray(responseObject.failures, "ECS describe-tasks failures");

  if (failures.length > 0) {
    throw new Error(`ECS could not describe the migration task: ${formatEcsFailures(failures)}.`);
  }

  const tasks = requireArray(responseObject.tasks, "ECS describe-tasks tasks");
  if (tasks.length !== 1) {
    throw new Error(`ECS returned ${tasks.length} task results; expected exactly one for ${taskArn}.`);
  }

  const task = requireObject(tasks[0], "ECS described task");
  const stoppedReason = optionalString(task.stoppedReason);
  const containers = requireArray(task.containers, "ECS task containers");

  console.log("Migration task result:");
  console.log(`  Task ARN: ${taskArn}`);
  console.log(`  Stopped reason: ${stoppedReason ?? "Not reported"}`);

  if (containers.length !== 1) {
    throw new Error(
      `Missing unambiguous migration container result: expected one container, received ${containers.length}.`,
    );
  }

  const container = requireObject(containers[0], "ECS migration container");
  const containerName = optionalString(container.name);
  const containerStatus = optionalString(container.lastStatus);
  const containerReason = optionalString(container.reason);
  const exitCode = container.exitCode;

  console.log(`  Container name: ${containerName ?? "Not reported"}`);
  console.log(`  Container status: ${containerStatus ?? "Not reported"}`);
  console.log(`  Container reason: ${containerReason ?? "Not reported"}`);
  console.log(`  Exit code: ${typeof exitCode === "number" ? exitCode : "Not reported"}`);

  if (
    containerName === undefined ||
    containerStatus === undefined ||
    typeof exitCode !== "number" ||
    !Number.isInteger(exitCode)
  ) {
    throw new Error(
      "The stopped task did not include a complete migration container result. Inspect the ECS task and logs before retrying.",
    );
  }

  return exitCode;
}

function runAwsJson(
  args: readonly string[],
  context: AwsContext,
  failureMessage: string,
): unknown {
  const output = runAws([...args, "--output", "json"], context, failureMessage);
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error(`${failureMessage}: AWS CLI returned invalid JSON.`);
  }
}

function runAws(args: readonly string[], context: AwsContext, failureMessage: string): string {
  const commandArgs = [
    ...args,
    "--profile",
    context.profile,
    "--region",
    context.region,
    "--no-cli-pager",
  ];
  const result = spawnSync("aws", commandArgs, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error !== undefined) {
    const errorCode = (result.error as NodeJS.ErrnoException).code;
    if (errorCode === "ENOENT") {
      throw new Error("AWS CLI was not found. Install AWS CLI v2 and retry.");
    }
    throw new Error(`${failureMessage}: could not start AWS CLI (${result.error.message}).`);
  }

  if (result.status !== 0) {
    const detail = getAwsErrorDetail(result.stderr);
    if (isAuthenticationError(result.stderr)) {
      throw new Error(
        `AWS authentication failed for profile ${context.profile}. Refresh or repair the profile and retry. ${detail}`,
      );
    }
    if (/stack.+does not exist/iu.test(result.stderr)) {
      throw new Error(`${failureMessage}: the stack does not exist. Deploy the ComputeStack first. ${detail}`);
    }
    throw new Error(`${failureMessage}. ${detail}`);
  }

  return result.stdout;
}

function getAwsErrorDetail(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const detail = lines.at(-1) ?? "AWS CLI returned no error details.";
  return detail.length > 500 ? `${detail.slice(0, 497)}...` : detail;
}

function isAuthenticationError(stderr: string): boolean {
  return /(profile.+could not be found|unable to locate credentials|expiredtoken|token has expired|security token.+invalid|error loading sso token|sso session.+expired|invalid_grant)/iu.test(
    stderr,
  );
}

function formatEcsFailures(failures: readonly unknown[]): string {
  return failures
    .map((failure, index) => {
      const failureObject = requireObject(failure, `ECS failure ${index + 1}`);
      const arn = optionalString(failureObject.arn) ?? "unknown resource";
      const reason = optionalString(failureObject.reason) ?? "unknown reason";
      const detail = optionalString(failureObject.detail);
      return detail === undefined ? `${arn}: ${reason}` : `${arn}: ${reason} (${detail})`;
    })
    .join("; ");
}

function requireObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} has an unexpected JSON shape.`);
  }
  return value as JsonObject;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} has an unexpected JSON shape.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): readonly string[] {
  const values = requireArray(value, label);
  if (!values.every((entry): entry is string => typeof entry === "string" && entry.length > 0)) {
    throw new Error(`${label} has an unexpected JSON shape.`);
  }
  return values;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
}
