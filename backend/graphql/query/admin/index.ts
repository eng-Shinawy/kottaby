/**
 * Admin query barrel — side-effect imports every admin-surface query file.
 *
 * Per `backend/graphql/query/AGENTS.md`: each entry is a side-effect import
 * — the imported file registers root query fields on `gqlSchemaBuilder` at
 * import time. They have no named exports.
 */
import "./audit-log.query";
