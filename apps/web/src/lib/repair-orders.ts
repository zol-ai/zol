/**
 * The statuses a ticket moves through, and what a human calls each one.
 *
 * The definitions moved to `lib/statuses.ts` when the rest of the product
 * grew its own vocabularies; these names stay so the screens written against
 * them keep compiling. Kept out of the actions file for the reason it always
 * was: a "use server" module may only export async functions, and a constant
 * exported from one is a build error rather than a runtime surprise.
 */

export {
  RO_STATUSES as STATUSES,
  RO_STATUS_LABEL as STATUS_LABEL,
  RO_STATUS_TONE as STATUS_TONE,
  RO_PIPELINE as PIPELINE,
  RO_OPEN_STATUSES as OPEN_STATUSES,
  isRoStatus as isStatus,
} from "./statuses";

export type { RoStatus as Status } from "./statuses";
