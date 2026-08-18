interface NamingIdentity {
  readonly projectName: string;
  readonly name: string;
}

export function getStackName(environment: NamingIdentity, component: string): string {
  return getResourceName(environment, component);
}

export function getResourceName(environment: NamingIdentity, component: string): string {
  return `${environment.projectName}-${environment.name}-${component}`;
}
