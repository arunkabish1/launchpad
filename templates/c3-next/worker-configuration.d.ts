/* eslint-disable */
// Minimal stub (Launchpad): pulls in workers-types globals (Env, ExportedHandler) and declares CloudflareBindings.
/// <reference types="@cloudflare/workers-types" />
interface CloudflareBindings {}
declare namespace Cloudflare {
  interface Env {}
  interface GlobalProps {}
}
