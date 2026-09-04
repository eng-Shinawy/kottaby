const Module = globalThis.process.getBuiltinModule("node:module");
const RESOLVE_FILENAME = "_resolveFilename";
// Captured via Reflect.get so the unbound references only ever flow through the
// `.call(this, ...)` shims below — direct property aliasing would trip `unbound-method`.
const origRequire = Reflect.get(Module.prototype, "require");
const origResolve = Reflect.get(Module, RESOLVE_FILENAME);

Module[RESOLVE_FILENAME] = function (request, parent, isMain, options) {
  if (request.includes("typescript/lib/tsserverlibrary")) {
    return origResolve.call(this, "@typescript/typescript6/lib/tsserverlibrary.js", parent, isMain, options);
  }
  if (request === "typescript" || request.startsWith("typescript/")) {
    const updated = request.replace(/^typescript/, "@typescript/typescript6");
    return origResolve.call(this, updated, parent, isMain, options);
  }
  return origResolve.call(this, request, parent, isMain, options);
};

Module.prototype.require = function (id) {
  if (id.includes("typescript/lib/tsserverlibrary")) {
    return origRequire.call(this, "@typescript/typescript6/lib/tsserverlibrary.js");
  }
  if (id === "typescript" || id.startsWith("typescript/")) {
    return origRequire.call(this, id.replace(/^typescript/, "@typescript/typescript6"));
  }
  return origRequire.call(this, id);
};
