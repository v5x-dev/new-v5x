/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as betterAuth_auth from "../betterAuth/auth.js";
import type * as buildPool from "../buildPool.js";
import type * as buildPoolWorker from "../buildPoolWorker.js";
import type * as buildRequest from "../buildRequest.js";
import type * as crons from "../crons.js";
import type * as ezTemplate from "../ezTemplate.js";
import type * as feedback from "../feedback.js";
import type * as http from "../http.js";
import type * as jarTemplate from "../jarTemplate.js";
import type * as lib_buildCloud from "../lib/buildCloud.js";
import type * as lib_buildSdk from "../lib/buildSdk.js";
import type * as program from "../program.js";
import type * as programBuild from "../programBuild.js";
import type * as programBuildCache from "../programBuildCache.js";
import type * as store from "../store.js";
import type * as template from "../template.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "betterAuth/auth": typeof betterAuth_auth;
  buildPool: typeof buildPool;
  buildPoolWorker: typeof buildPoolWorker;
  buildRequest: typeof buildRequest;
  crons: typeof crons;
  ezTemplate: typeof ezTemplate;
  feedback: typeof feedback;
  http: typeof http;
  jarTemplate: typeof jarTemplate;
  "lib/buildCloud": typeof lib_buildCloud;
  "lib/buildSdk": typeof lib_buildSdk;
  program: typeof program;
  programBuild: typeof programBuild;
  programBuildCache: typeof programBuildCache;
  store: typeof store;
  template: typeof template;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
