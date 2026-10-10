/**
 * Gateway library barrel.
 *
 * Conventions (`AGENTS.md` barrel rules): `./`-relative paths only, `export *`
 * exclusively, no imports, one path segment per statement.
 *
 * Modules:
 *  - `./version`            — `resolveAppVersion()` for the health payload.
 *  - `./public-operations`  — closed public-operation allowlist.
 *  - `./route-inventory`    — classifying registry for every API route.
 *  - `./transport-guard`    — pure transport guards + canonical body-limit /
 *    operation-count constants.
 */

export * from "./public-operations";
export * from "./route-inventory";
export * from "./transport-guard";
export * from "./version";
