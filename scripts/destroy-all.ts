import { spawnSync } from "node:child_process";
import { promises as dns } from "node:dns";

const PROFILE = "aws-prueba-dev";
const REGION = "us-east-1";
const CONFIRM = "DESTROY-aws-prueba-dev";
const ZONE = "chess-mentor.com.";
const APP_STACKS = [
  "aws-prueba-dev-compute",
  "aws-prueba-dev-serverless",
  "aws-prueba-dev-data",
  "aws-prueba-dev-network",
] as const;
const BOOTSTRAP = "CDKToolkit";
const ALL_STACKS = [...APP_STACKS, BOOTSTRAP] as const;
const DELETABLE_STATUSES = new Set(["CREATE_COMPLETE", "ROLLBACK_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "IMPORT_COMPLETE", "IMPORT_ROLLBACK_COMPLETE"]);

interface Options { readonly profile: string; readonly dryRun: boolean; readonly deleteZone: boolean; readonly confirmation?: string }
interface AwsContext { readonly profile: string; readonly region: string }

interface Stack { readonly StackName: string; readonly StackId: string; readonly StackStatus: string; readonly EnableTerminationProtection: boolean }

interface StackResource { readonly ResourceType?: string; readonly PhysicalResourceId?: string }
interface ImageId { readonly imageDigest?: string; readonly imageTag?: string }
interface S3Version { readonly Key?: string; readonly VersionId?: string }

class DnsBlockedError extends Error {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const options = parseOptions(args);
  if (options.dryRun) {
    printPlan(options, true);
    return;
  }
  if (options.confirmation !== CONFIRM) {
    throw new Error(`Confirmation required: --confirm ${CONFIRM}. No AWS request was made.`);
  }

  const context = { profile: options.profile, region: REGION };
  const identity = parseJson<{ Account?: string; Arn?: string }>(
    requireOutput(runAws(["sts", "get-caller-identity", "--output", "json"], context)),
    "STS identity",
  );
  if (!identity.Account || !identity.Arn || /[\r\n]/u.test(identity.Arn)) {
    throw new Error("STS returned an unusable caller identity. No mutation was attempted.");
  }
  console.log(`AWS identity: ${identity.Account} ${identity.Arn}`);
  printPlan(options, false);

  for (const name of APP_STACKS) deleteStack(name, context);
  cleanupBootstrap(context);

  let route53 = "preserved (default; it may continue charging)";
  if (options.deleteZone) {
    try {
      await cleanupDns(context);
      route53 = "deleted";
    } catch (error) {
      if (!(error instanceof DnsBlockedError)) throw error;
      route53 = `blocked and preserved: ${error.message}`;
      process.exitCode = 1;
    }
  }

  for (const name of ALL_STACKS) {
    if (describeStack(name, context)) throw new Error(`Final check found stack ${name}.`);
  }
  console.log("Teardown complete: the four application stacks and CDKToolkit are absent.");
  console.log(`Route 53: ${route53}.`);
  console.log("AWS billing can lag; accrued charges remain. Squarespace registration is outside AWS.");
}

function parseOptions(args: readonly string[]): Options {
  let profile = PROFILE;
  let confirmation: string | undefined;
  let dryRun = false;
  let deleteZone = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") dryRun = true;
    else if (argument === "--delete-hosted-zone") deleteZone = true;
    else if (argument === "--profile" || argument === "--confirm") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      if (argument === "--profile") profile = value;
      else confirmation = value;
      index += 1;
    } else throw new Error(`Unknown option: ${String(argument)}. Use --help.`);
  }

  if (!profile.trim() || /[\r\n\0]/u.test(profile)) {
    throw new Error("AWS profile must be a non-empty single-line value.");
  }
  return { profile, dryRun, deleteZone, ...(confirmation ? { confirmation } : {}) };
}

function printHelp(): void {
  console.log(`Safely tear down the disposable aws-prueba development environment.

Usage:
  pnpm destroy:all -- --dry-run
  pnpm destroy:all -- --confirm ${CONFIRM}
  pnpm destroy:all -- --profile <name> --confirm ${CONFIRM}
  pnpm destroy:all -- --confirm ${CONFIRM} --delete-hosted-zone

Options:
  --confirm <phrase>     Required exact destructive confirmation
  --delete-hosted-zone  Attempt protected deletion of ${ZONE}
  --dry-run             Print the plan without invoking AWS or DNS
  --profile <name>      AWS profile (default: ${PROFILE})
  -h, --help            Show help without invoking AWS or DNS

CDKToolkit cleanup removes current/versioned S3 objects, delete markers, and ECR images.`);
}

function printPlan(options: Options, dryRun: boolean): void {
  console.log(`${dryRun ? "Dry-run" : "Confirmed"} plan (${options.profile}, ${REGION}):`);
  ALL_STACKS.forEach((name, index) => console.log(`  ${index + 1}. ${name}`));
  console.log("  CDKToolkit: empty current/versioned S3 objects, delete markers, and ECR images.");
  console.log(
    options.deleteZone
      ? `  Route 53: delete ${ZONE} only after delegation and record safety checks.`
      : `  Route 53: preserve ${ZONE}`,
  );
  if (dryRun) console.log("No AWS CLI command or DNS lookup was performed.");
}

function describeStack(name: string, context: AwsContext): Stack | undefined {
  const output = runAws(
    ["cloudformation", "describe-stacks", "--stack-name", name, "--output", "json"],
    context,
    true,
  );
  if (output === undefined) return undefined;
  const stacks = parseJson<{ Stacks?: Stack[] }>(output, `stack ${name}`).Stacks;
  const stack = stacks?.length === 1 ? stacks[0] : undefined;
  if (
    !stack ||
    stack.StackName !== name ||
    !stack.StackId ||
    !stack.StackStatus ||
    typeof stack.EnableTerminationProtection !== "boolean"
  ) {
    throw new Error(`Unexpected CloudFormation response for exact stack ${name}.`);
  }
  return stack;
}

function deleteStack(name: string, context: AwsContext, knownStack?: Stack): void {
  const stack = knownStack ?? describeStack(name, context);
  if (!stack) {
    console.log(`Skip ${name}: absent.`);
    return;
  }
  if (stack.StackStatus === "DELETE_IN_PROGRESS") {
    console.log(`Wait ${name}: deletion already in progress.`);
  } else {
    if (!DELETABLE_STATUSES.has(stack.StackStatus)) {
      throw new Error(`Stack ${name} is ${stack.StackStatus}; inspect it before retrying.`);
    }
    if (stack.EnableTerminationProtection) {
      runAws(
        [
          "cloudformation",
          "update-termination-protection",
          "--stack-name",
          stack.StackId,
          "--no-enable-termination-protection",
        ],
        context,
      );
    }
    console.log(`Delete ${name}.`);
    runAws(["cloudformation", "delete-stack", "--stack-name", stack.StackId], context);
  }
  runAws(
    ["cloudformation", "wait", "stack-delete-complete", "--stack-name", stack.StackId],
    context,
  );
}

function cleanupBootstrap(context: AwsContext): void {
  const stack = describeStack(BOOTSTRAP, context);
  if (!stack) {
    console.log(`Skip ${BOOTSTRAP}: absent.`);
    return;
  }
  if (stack.StackStatus === "DELETE_IN_PROGRESS") {
    deleteStack(BOOTSTRAP, context, stack);
    return;
  }
  if (!DELETABLE_STATUSES.has(stack.StackStatus)) {
    throw new Error(`Stack ${BOOTSTRAP} is ${stack.StackStatus}; inspect it before retrying.`);
  }

  const resources = parseJson<{ StackResourceSummaries?: StackResource[] }>(
    requireOutput(
      runAws(
        ["cloudformation", "list-stack-resources", "--stack-name", stack.StackId, "--output", "json"],
        context,
      ),
    ),
    "CDKToolkit resources",
  ).StackResourceSummaries;
  const physicalId = (type: string): string => {
    const matches = (resources ?? []).filter((resource) => resource.ResourceType === type);
    if (matches.length !== 1 || !matches[0]?.PhysicalResourceId) {
      throw new Error(`CDKToolkit must contain exactly one ${type} resource.`);
    }
    return matches[0].PhysicalResourceId;
  };
  const bucket = physicalId("AWS::S3::Bucket");
  const repository = physicalId("AWS::ECR::Repository");

  const versioning = parseJson<{ Status?: string }>(
    requireOutput(
      runAws(["s3api", "get-bucket-versioning", "--bucket", bucket, "--output", "json"], context),
    ),
    "S3 versioning",
  );
  if (versioning.Status === "Enabled" || versioning.Status === "Suspended") {
    emptyVersionedBucket(bucket, context);
  } else {
    if (versioning.Status !== undefined) throw new Error(`Unexpected S3 versioning status: ${versioning.Status}.`);
    try {
      runAws(["s3", "rm", `s3://${bucket}`, "--recursive", "--only-show-errors"], context);
    } catch {
      throw new Error(`Could not empty ${bucket}. Remove retained/current objects, then retry.`);
    }
  }

  const imageIds = parseJson<{ imageIds?: ImageId[] }>(
    requireOutput(
      runAws(["ecr", "list-images", "--repository-name", repository, "--output", "json"], context),
    ),
    "ECR images",
  ).imageIds ?? [];
  for (let index = 0; index < imageIds.length; index += 100) {
    const batch = imageIds.slice(index, index + 100);
    if (batch.some((image) => !image.imageDigest && !image.imageTag)) {
      throw new Error(`ECR returned an invalid image ID for ${repository}.`);
    }
    const response = parseJson<{ failures?: unknown[] }>(
      requireOutput(
        runAws(
          ["ecr", "batch-delete-image", "--repository-name", repository, "--image-ids", JSON.stringify(batch), "--output", "json"],
          context,
        ),
      ),
      "ECR image deletion",
    );
    if (response.failures?.length) throw new Error(`ECR could not empty ${repository}.`);
  }
  deleteStack(BOOTSTRAP, context, stack);
}

function emptyVersionedBucket(bucket: string, context: AwsContext): void {
  const versions = listObjectVersions(bucket, context);
  for (let index = 0; index < versions.length; index += 1000) {
    const batch = versions.slice(index, index + 1000);
    const response = parseJson<{ Errors?: unknown[] }>(
      requireOutput(
        runAws(
          [
            "s3api",
            "delete-objects",
            "--bucket",
            bucket,
            "--delete",
            JSON.stringify({ Objects: batch, Quiet: false }),
            "--output",
            "json",
          ],
          context,
        ),
      ),
      "S3 version deletion",
    );
    if (response.Errors?.length) {
      throw new Error(`S3 failed to delete ${response.Errors.length} version(s) from ${bucket}.`);
    }
  }
  if (listObjectVersions(bucket, context).length !== 0) {
    throw new Error(`Versioned bucket ${bucket} is not empty after deletion; inspect retention settings.`);
  }
}

function listObjectVersions(bucket: string, context: AwsContext): { Key: string; VersionId: string }[] {
  const response = parseJson<{ Versions?: S3Version[]; DeleteMarkers?: S3Version[] }>(
    requireOutput(
      runAws(["s3api", "list-object-versions", "--bucket", bucket, "--output", "json"], context),
    ),
    "S3 object versions",
  );
  return [...(response.Versions ?? []), ...(response.DeleteMarkers ?? [])].map((version) => {
    if (!version.Key || !version.VersionId) throw new Error(`S3 returned an invalid version for ${bucket}.`);
    return { Key: version.Key, VersionId: version.VersionId };
  });
}

async function cleanupDns(context: AwsContext): Promise<void> {
  let nameservers: readonly string[];
  try {
    nameservers = await dns.resolveNs(ZONE.slice(0, -1));
  } catch {
    throw new DnsBlockedError("public NS records could not be resolved");
  }
  if (!nameservers.length) throw new DnsBlockedError("public NS records are empty");
  if (nameservers.some((server) => server.toLowerCase().includes("awsdns"))) {
    throw new DnsBlockedError("public DNS still uses awsdns; restore Squarespace nameservers and wait");
  }
  interface HostedZone { readonly Id?: string; readonly Name?: string; readonly Config?: { readonly PrivateZone?: boolean } }
  const zones = parseJson<{ HostedZones?: HostedZone[] }>(
    requireOutput(
      runAws(["route53", "list-hosted-zones-by-name", "--dns-name", ZONE, "--output", "json"], context),
    ),
    "Route 53 zones",
  ).HostedZones ?? [];
  const matches = zones.filter((zone) => zone.Name === ZONE && zone.Config?.PrivateZone === false);
  if (matches.length !== 1 || !matches[0]?.Id) {
    throw new DnsBlockedError(`expected one exact public zone; found ${matches.length}`);
  }

  const records = parseJson<{ ResourceRecordSets?: { Name?: string; Type?: string }[] }>(
    requireOutput(
      runAws(["route53", "list-resource-record-sets", "--hosted-zone-id", matches[0].Id, "--output", "json"], context),
    ),
    "Route 53 records",
  ).ResourceRecordSets ?? [];
  const types = new Set(records.map((record) => record.Type));
  if (
    records.length !== 2 ||
    records.some((record) => record.Name !== ZONE || !["NS", "SOA"].includes(record.Type ?? "")) ||
    !types.has("NS") ||
    !types.has("SOA")
  ) {
    throw new DnsBlockedError("records other than the zone NS/SOA defaults remain");
  }

  const deletion = parseJson<{ ChangeInfo?: { Id?: string } }>(
    requireOutput(
      runAws(["route53", "delete-hosted-zone", "--id", matches[0].Id, "--output", "json"], context),
    ),
    "Route 53 deletion",
  );
  if (!deletion.ChangeInfo?.Id) throw new Error("Route 53 returned no deletion change ID.");
  runAws(["route53", "wait", "resource-record-sets-changed", "--id", deletion.ChangeInfo.Id], context);
}

function parseJson<T>(output: string, label: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function requireOutput(output: string | undefined): string {
  if (output === undefined) throw new Error("AWS CLI returned no output.");
  return output;
}

function runAws(args: readonly string[], context: AwsContext, allowMissingStack = false): string | undefined {
  const result = spawnSync(
    "aws",
    [...args, "--profile", context.profile, "--region", context.region, "--no-cli-pager", "--no-cli-auto-prompt"],
    { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.error) {
    if ((result.error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("AWS CLI was not found.");
    throw new Error(`AWS CLI could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (allowMissingStack && /does not exist/iu.test(result.stderr)) return undefined;
    const detail = result.stderr.trim().split(/\r?\n/u).at(-1) ?? "unknown error";
    if (/credentials|expired|profile.+not be found|sso/iu.test(detail)) {
      throw new Error(`AWS authentication failed for profile ${context.profile}.`);
    }
    throw new Error(`AWS CLI failed: ${detail.slice(0, 300)}`);
  }
  return result.stdout;
}

main().catch((error: unknown) => {
  console.error(`Teardown failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
