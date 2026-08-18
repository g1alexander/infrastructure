export interface EnvironmentConfig {
  readonly projectName: "aws-prueba";
  readonly name: "dev";
  readonly account: string | undefined;
  readonly region: "us-east-1";
}

const environments = {
  dev: {
    projectName: "aws-prueba",
    name: "dev",
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
} as const satisfies Record<string, EnvironmentConfig>;

export type EnvironmentName = keyof typeof environments;

export function getEnvironmentConfig(name: unknown): EnvironmentConfig {
  if (typeof name !== "string" || !(name in environments)) {
    throw new Error(`Unsupported environment: ${String(name)}. Only dev is configured.`);
  }

  return environments[name as EnvironmentName];
}
