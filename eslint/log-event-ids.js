/** Discourage raw string event ids in structured log calls (backend packages only). */
export const logEventIdRules = {
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(debug|info|warn|error)$/][callee.object.type='Identifier'][callee.object.name=/^(log|runLog|child)$/] > Literal:first-child",
      message:
        "Use LogEvents.* constants for the first argument to log.debug/info/warn/error.",
    },
  ],
};
