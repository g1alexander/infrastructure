import type { EnvironmentConfig } from "./environments";

type NamingIdentity = Pick<EnvironmentConfig, "projectName" | "name">;

export function getStackName(environment: NamingIdentity, component: string): string {
  return `${environment.projectName}-${environment.name}-${component}`;
}
