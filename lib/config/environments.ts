export interface EnvironmentConfig {
  readonly name: "dev";
  readonly account: string | undefined;
  readonly region: "us-east-1";
  readonly stackName: "aws-prueba-dev-foundation";
}

const environments = {
  dev: {
    name: "dev",
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
    stackName: "aws-prueba-dev-foundation",
  },
} as const satisfies Record<string, EnvironmentConfig>;

export type EnvironmentName = keyof typeof environments;

export function getEnvironmentConfig(name: unknown): EnvironmentConfig {
  if (typeof name !== "string" || !(name in environments)) {
    throw new Error(`Unsupported environment: ${String(name)}. Only dev is configured.`);
  }

  return environments[name as EnvironmentName];
}
