# Auditoría de seguridad: Node.js (octubre 2026), Railway y Stripe

**Proyecto:** git-graph (`alvaromunozmx/git-graph-claude`)
**Fecha:** 2026-10-24
**Ramas revisadas:** `develop` (0.4.0), `main` (0.3.36, `814bb6a`), `assets` y todo el historial de git
**Motivo:** tres avisos recibidos para el proyecto de producción de Black Anchor Fleet (BAF): el de Stripe sobre Node.js, el incidente de Railway del 21 de octubre y su actualización del 24 de octubre. Este documento responde si git-graph usa algo de lo afectado y qué hay que hacer en este proyecto.

## Resumen

git-graph **no usa Railway ni Stripe, ni guarda ninguna llave de API**, así que los avisos de Railway y Stripe no exigen nada en este proyecto. Lo que sí le toca es la **vulnerabilidad de Node.js**. Node no corre en producción aquí: solo en las máquinas de desarrollo y en GitHub Actions, y las dos usan versiones sin parche.

| Aviso | ¿Afecta a git-graph? | Acción en este proyecto |
| :- | :- | :- |
| Node.js, 21 de octubre (CVE-2026-111497, RCE en Brotli, y 9 más) | **Sí, solo en desarrollo y CI.** El plugin no corre sobre Node. | Actualizar Node local y fijar versiones con parche en CI |
| Railway: incidente del 21 de octubre y revocación de llaves | **No.** Nada de git-graph se despliega en Railway. | Ninguna aquí. Revisar el workspace BAF por separado |
| Stripe: Node.js sin parche | **No.** git-graph no usa Stripe. | Ninguna aquí. Aplica a los servicios de BAF |
| Revisar GitHub por accesos desconocidos (lo pide Railway) | Repo revisado: limpio | Revisar a mano la cuenta de GitHub (ver punto 5) |

## 1. El aviso de Node.js

- **Qué es:** CVE-2026-111497, una escritura fuera de límites en el decodificador Brotli que Node.js trae incluido. Si una aplicación descomprime con `node:zlib` datos Brotli que vienen de afuera, un atacante puede corromper memoria, leerla o ejecutar código. `fetch()` y Express 5 descomprimen Brotli automáticamente, lo que lo hace más fácil de alcanzar.
- **También corrige:** dos formas de saltarse la validación del nombre en certificados TLS (CVE-2026-106069 y CVE-2026-105483) y un truncamiento de nombres en `dns.resolve` (CVE-2026-105482).
- **Versiones afectadas:** todas las líneas soportadas antes del parche. Node 20 y anteriores ya no reciben corrección.
- **Versiones corregidas:** **22.23.4**, **24.22.1** y **26.12.1**. No hay mitigación temporal: hay que actualizar.

## 2. Dónde corre Node en git-graph

| Lugar | Versión encontrada | ¿Con parche? | Exposición |
| :- | :- | :- | :- |
| **El plugin, para quien lo instala** | No usa Node: corre dentro del runtime propio de Claude Code, sin Node ni DOM | n/a | Ninguna por Node. El código no usa `zlib`, `fetch` ni red: solo `$.process.run` (git, portapapeles), `$.fs.list`/`$.fs.exists` y `$.store` |
| **Claude Code en esta Mac** | 2.1.304, binario nativo (Mach-O arm64) | No se puede saber desde aquí | Depende del runtime que Claude Code trae incluido. Ver punto 4 |
| **Node local** (`/usr/local/bin/node`) | **v22.15.0** | **No** (necesita 22.23.4) | Baja para git-graph: solo corre pruebas y `scripts/zip.mjs`, sin datos de afuera. **Si esta Mac también corre servicios de BAF, la exposición es mayor** |
| **CI: workflow `test`**, matriz Node 22 y 24 | Última corrida (2026-10-20): **22.23.3, 24.21.0, 24.22.0** | **No** | Baja: runners efímeros que solo corren el código del repo. Pero `actions/setup-node@v4` con `node-version: 22`/`24` usa la versión en la caché del runner, que puede ir días atrás del parche |
| **CI: workflow `release`**, Node 24 | Última corrida (v0.3.36, 2026-10-21): **24.22.0** | **No** | Baja: igual que arriba. Publica el zip del release con `contents: write` |
| **CI: job `mod`** | Instala `@anthropic-ai/claude-code` sin versión fija (corrió 2.1.304) | n/a | Riesgo de cadena de suministro: cada corrida baja la última versión publicada |

**Dependencias de npm:** no hay. `package.json` no declara dependencias, no hay `package-lock.json` ni `node_modules`, y los scripts solo usan módulos de Node (`node:fs`, `node:path`, `node:child_process`, `node:test`). `npm audit` no tiene nada que revisar.

## 3. Llaves, secretos, Railway y Stripe

Revisé todo el historial de git (todas las ramas, `assets` incluida) buscando patrones de llaves de Stripe (`sk_live_`, `sk_test_`, `rk_`), Anthropic (`sk-ant-`), OpenAI (`sk-…`), AWS (`AKIA…`), GitHub (`ghp_`, `github_pat_`), Slack, llaves privadas PEM y variables `RAILWAY_*`, `STRIPE_*`, `OPENAI_API_KEY` y `ANTHROPIC_API_KEY`.

- **Resultado:** ninguna coincidencia.
- **Archivos:** en ningún momento del historial hubo `.env`, `railway.json`, `Dockerfile`, `Procfile`, `.pem` ni `.key`.
- **Railway:** el proyecto no se despliega ahí. No hay nada que rotar ni redesplegar por git-graph.
- **Stripe:** no hay integración ni llaves.
- **Llaves de Anthropic y OpenAI:** git-graph no usa llaves de API. Los dos prompts que manda a Claude usan la sesión del usuario en Claude Code, y CI no tiene ningún secreto de Anthropic.

## 4. Claude Code

El plugin corre dentro de Claude Code, y Claude Code 2.1.304 es un binario nativo con su propio runtime incluido. Desde aquí no puedo saber si ese runtime usa el Brotli afectado.

- **Acción:** actualizar Claude Code a la última versión (`claude update`) y revisar las notas de versión y los avisos de seguridad de Anthropic de esta semana.

## 5. GitHub (lo que pide revisar el aviso de Railway)

Revisión del repo `alvaromunozmx/git-graph-claude`, solo lectura:

| Qué | Encontrado | Estado |
| :- | :- | :- |
| Secretos y variables de Actions | Ninguno | ✅ |
| Deploy keys | Ninguna | ✅ |
| Webhooks | Uno: `api.anthropic.com/directory-webhooks/…`, evento `push`, creado el 2026-10-20 20:35 UTC | ✅ Esperado: es el webhook del directorio de plugins que configuraste |
| Colaboradores | Solo `alvaromunozmx` (admin) | ✅ |
| Permisos por defecto de `GITHUB_TOKEN` | `read`; no puede aprobar PRs | ✅ |
| Acciones permitidas | Todas, sin exigir versiones fijas por SHA | ⚠️ Endurecer (punto 6) |
| Protección de `main` | Ninguna | ⚠️ Recomendado: el directorio publica desde `main` |
| Corridas recientes de Actions | Solo pushes tuyos a `main` y tags `v0.3.34`–`v0.3.36`, todas exitosas | ✅ |

**Lo que no pude revisar** (el token de `gh` no tiene esos permisos) y conviene revisar a mano:
- **Llaves SSH y de firma:** github.com/settings/keys
- **Tokens personales:** github.com/settings/tokens (clásicos y fine-grained)
- **Apps autorizadas:** github.com/settings/applications (OAuth y GitHub Apps, incluida la app de Claude instalada para el directorio)
- **Registro de seguridad de la cuenta:** github.com/settings/security-log (inicios de sesión, tokens creados, cambios desde el 21 de octubre)

## 6. Actividades a realizar en git-graph

**Prioridad alta**
1. **Actualizar Node local** de v22.15.0 a **22.23.4** o más reciente, o a **24.22.1** o más reciente. `engines` ya pide `>=22.6`, así que cualquiera de las dos funciona.
2. ✅ **Fijar versiones con parche en CI.** Hecho en `develop`: `check-latest: true` en cada `actions/setup-node` de `test.yml` y `release.yml`, con un paso `node --version` que lo deja escrito en el log. `test.yml` ahora también corre en push a `develop`, para comprobarlo sin tocar `main`. Confirmado en la corrida `40123330965` sobre `develop` (2026-10-24): los 7 jobs pasaron con **v22.23.4** y **v24.22.1**, y el job `mod` instaló `@anthropic-ai/claude-code@2.1.304`.
3. ✅ **Actualizar Claude Code.** Hecho el 2026-10-26: el CLI pasó de 2.1.304 a **2.1.310** con `claude update`. Queda pendiente: no encontré en sus notas públicas si esa versión cambia el runtime por este aviso. La pestaña Code de Claude Desktop trae su propio Claude Code, que se actualiza al actualizar la app; `/status` ahí muestra la versión.

**Prioridad media**
4. ✅ **Fijar la versión de Claude Code** del job `mod`. Hecho en `develop`: `@anthropic-ai/claude-code@2.1.304`, la versión con la que se prueba el mod. Hay que subirla a propósito cuando se pruebe una nueva.
5. **Fijar las acciones por SHA** (`actions/checkout`, `actions/setup-node`, `softprops/action-gh-release`). Pendiente. ✅ Ya está `permissions: contents: read` explícito en `test.yml`.
6. **Proteger `main`:** sin force-push, sin borrado, y que pase el workflow `test` antes del merge. El directorio toma de ahí cada versión nueva.
7. **Revisar a mano la cuenta de GitHub** (punto 5): llaves, tokens, apps y el registro de seguridad desde el 21 de octubre.

**Sin acción en git-graph**
- Railway: rotar variables y redesplegar no aplica. No hay despliegue ni variables.
- Stripe: revisar logs y rotar llaves no aplica. No hay integración.

## 7. Fuera de alcance: BAF

Los avisos sí aplican al proyecto de producción de BAF, que este documento no revisa. Puntos para su propia auditoría:

**Node.js**
- Revisar la versión de Node en cada servicio de Railway: `engines`, `.nvmrc` o `.node-version`, imagen base del `Dockerfile` o `NIXPACKS_NODE_VERSION`.
- Confirmar después del redespliegue, en los logs de build o con `node --version` en el servicio.

**Railway**
- Rotar en este orden: arreglar el entorno primero y generar llaves nuevas después, como pide Stripe.
- Lo que hay que rotar: llaves de Stripe, de IA (OpenAI y Anthropic), de la base de datos y tokens.
- Actualizar las variables en Railway y redesplegar.
- Revisar si OpenAI o Anthropic revocaron llaves del lote del 24 de octubre, aunque sean llaves de reemplazo.

**Revisión de actividad**
- Stripe: logs de requests y el Dashboard desde el 21 de octubre.
- Proveedores de IA: uso inesperado.
- GitHub y Docker Hub: accesos o cambios desconocidos.

## Fuentes

- [Node.js: October 21, 2026 Security Releases](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [The Hacker News: Node.js Brotli decoder bug could allow remote code execution](https://thehackernews.com/2026/10/nodejs-brotli-decoder-bug-could-allow.html)
- [SOC Prime: CVE-2026-111497](https://socprime.com/blog/cve-2026-111497-node-js-brotli-decoder-flaw-enables-remote-code-execution/)
- [Astra: Node.js security release, October 2026](https://www.getastra.com/blog/security-advisory/node-js-security-release/)
- Correos de Stripe (referencia FTV37SYWJ) y Railway (21 y 24 de octubre), recibidos para el workspace BAF.

## Cómo se obtuvo cada dato

| Dato | De dónde |
| :- | :- |
| Node local | `node --version` |
| Claude Code | `claude --version`, y `file` sobre su binario |
| CI | Logs de las corridas `39531387924` (release v0.3.36) y `39491512626` (test en `main`), líneas `Found in cache @` |
| Secretos | `git log --all -p`, con los patrones del punto 3 |
| GitHub | `gh secret list`, `gh variable list`, y `gh api` sobre `repos/…/keys`, `hooks`, `collaborators`, `actions/permissions` y `branches/main/protection` |
| APIs del plugin | Búsqueda de `$.<api>.<método>`, `zlib` y `fetch` en `hooks/` |
