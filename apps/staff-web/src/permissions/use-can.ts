import { useSession } from "../auth.ts";
import { can, type AccessResult, type RecordOwner, type StaffAction } from "./staff-permissions.ts";

/** `can` for the signed-in session. Use `can(action, useSession())` directly when the action varies per render. */
export const useCan = (action: StaffAction, owner?: RecordOwner): AccessResult => can(action, useSession(), owner);
