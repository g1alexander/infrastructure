# Contexto para retomar CI/CD y Amplify

Esta nota guarda las decisiones tomadas para continuar el trabajo más adelante. Los pipelines y Amplify todavía no están implementados.

## Estado actual

- Entorno: `dev` en `us-east-1`.
- Infraestructura definida con AWS CDK v2 y TypeScript.
- Stacks desplegados: Network, Data, Serverless y Compute.
- Rails funciona en ECS con PostgreSQL, Valkey y Sidekiq.
- Las migraciones se ejecutan con `pnpm migrate:dev`.
- Las Lambdas JavaScript y Python están desplegadas.
- API Rails disponible mediante HTTPS en `https://api-dev.chess-mentor.com`.
- DNS administrado por Route 53.
- El frontend `ui-vue` todavía no está desplegado en Amplify.

## Decisión sobre pipelines

La evolución prevista es usar pipelines independientes:

| Repositorio | Flujo previsto |
| --- | --- |
| `infrastructure` | Desplegar infraestructura estable mediante CDK. |
| `api-rails` | Probar Rails, construir imagen ARM64, publicar en ECR, migrar y actualizar ECS. |
| `lambda-js` | Probar, empaquetar y desplegar la Lambda JavaScript. |
| `lambda-python` | Probar, empaquetar y desplegar la Lambda Python. |
| `ui-vue` | Usar Amplify Hosting como pipeline del frontend. |

Los recursos de pipeline se definirán mediante CDK dentro de:

```text
infrastructure/lib/stacks/pipeline/
```

Regla principal: **cada recurso debe tener un solo propietario**. CDK central y un pipeline de aplicación no deben actualizar simultáneamente la misma imagen, Task Definition o Lambda.

## CodeConnections

- Los repositorios pueden ser privados.
- CodePipeline accederá a GitHub mediante AWS CodeConnections.
- CDK puede crear la conexión, pero inicialmente queda `PENDING`.
- Una persona debe autorizar una vez la GitHub App desde la consola.
- Después de la autorización, la conexión queda `AVAILABLE` y puede reutilizarse.
- No se deben guardar tokens en código, contextos ni buildspecs.

## Rails

Actualmente `ComputeStack` construye Rails mediante `DockerImageAsset` y usa el ECR de `CDKToolkit`.

Para independizar Rails será necesario:

1. Crear un ECR dedicado.
2. Publicar imágenes con el SHA del commit, no con `latest`.
3. Transferir la propiedad de Task Definitions y servicios sin doble gestión.
4. Ejecutar la migración antes de promover el release.
5. Verificar `/up` y los servicios ECS.

`pnpm migrate:dev` todavía usa el perfil local `aws-prueba-dev`. Antes de ejecutarlo desde CodeBuild deberá soportar credenciales temporales del service role sin `--profile`.

## Lambdas

Actualmente `ServerlessStack` es propietario del código de ambas Lambdas.

Antes de crear pipelines independientes, cada Lambda deberá recibir un stack pequeño propio o un mecanismo equivalente administrado por CloudFormation. No se debe actualizar directamente su código mientras `ServerlessStack` siga siendo propietario.

## Amplify

- `ui-vue` estará conectado a Amplify mediante la Amplify GitHub App.
- La autorización del repositorio privado es manual una sola vez.
- Amplify ejecutará el build y publicará `dist/`.
- Variable pública requerida: `VITE_API_URL=https://api-dev.chess-mentor.com`.
- Dominio sugerido: `app-dev.chess-mentor.com`.
- Rails deberá permitir ese origen mediante `UI_ORIGIN`.

## Próximo paso cuando se retome

1. Publicar `infrastructure` como repositorio privado.
2. Registrar las URLs y ramas de los cinco repositorios.
3. Implementar `PipelineFoundationStack` con CodeConnections.
4. Autorizar la conexión hasta que quede `AVAILABLE`.
5. Implementar y validar un pipeline por vez, comenzando por infraestructura.
