"use client";

/**
 * downloadTextFile — the audit-trail exports' shared browser-download flow.
 * Re-exported from the shared CSV module (the jscpd clone gate watches this
 * fragment through its single home there); the audit-trail export flows
 * keep importing it from this module so their import surface is untouched.
 */
export { downloadTextFile } from "@/frontend/views/admin/directory-shared/directory-csv";
