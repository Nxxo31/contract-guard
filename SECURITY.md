# Política de Seguridad — contract-guard

## Versiones soportadas

| Versión | Soporte de seguridad |
| ------- | ------------------- |
| 1.x     | ✅ Activo            |

contract-guard sigue *semantic versioning*. Solo la última versión `main` recibe
parches de seguridad.

## Reportar una vulnerabilidad

**No abras un issue público** para reportar vulnerabilidades de seguridad.

Escribe un email a **security@contract-guard.dev** (o contacta vía GitHub de forma
privada: `@Nxxo31`) con los siguientes datos:

- Descripción del problema y su impacto.
- Pasos para reproducirlo, PoC o ficheros de prueba.
- Versiones afectadas (output de `contract-guard --version`).
- Especificaciones OpenAPI/GraphQL de ejemplo, si aplica.

### Compromiso de respuesta

- **Confirmación inicial**: en menos de 72 horas.
- **Evaluación + plan**: en menos de 7 días.
- **Fix coordinado**: se publica un release parche (`patch` bump) y se divulga el
  advisory **una vez disponible el fix**, junto con crédito al reportante (salvo que
  este pida permanecer anónimo).

## Divulgación coordinada

Agradecemos dar tiempo para corregir antes de cualquier publicación pública del
detalle. Coordinaremos la fecha de divulgación contigo.

No ofrecemos recompensas económicas (*bug bounty*); este es un proyecto OSS
mantenido por la comunidad.

## Alcance

### En alcance

- Ejecución de código o *crash* al procesar especificaciones OpenAPI/GraphQL
  maliciosas o corruptas.
- Fugas de información por paths o funciones de reporte.
- Evasión del modo `--strict` en CI (breaking changes no detectados clasificados como
  safe/warning).
- Dependencias con CVEs conocidos y explotables.

### Fuera de alcance

- contract-guard **no expone HTTP ni escucha puertos**: la CLI se ejecuta 100%
  localmente. No hay superficie de red.
- No almacenamos secretos ni credenciales: cualquier fuga de información debiera
  provenir de inputs (specs) o de los reportes Markdown generados, no de servicios
  externos.
- Vulnerabilidades en dependencias que ya tienen upstream fix — repórtalas vía `npm
  audit` y actualiza con `npm update`.

## Medidas de seguridad

- **Análisis 100% local**: contract-guard no realiza llamadas a la red ni envía tus
  specs a servicios externos. Todo el parsing y diff ocurre en tu máquina/CI.
- **Sin dependencias de pago ni servicios externos** — revisión de
  dependencias vía `npm audit` en CI.
- Las specs se tratan como datos **no confiables**: el parser valida formatos esperados
  y rechaza versiones OpenAPI no soportadas.
- CI ejecuta `tsc --noEmit` + `eslint` + `vitest` en cada PR/push.

## Reporte de seguridad en dependencias

Para vulnerabilidades en dependencias listadas en `package.json`, abre un issue
normal indicando el paquete afectado y el CVE/GHSA correspondiente. Se priorizará
la actualización en el siguiente release.
