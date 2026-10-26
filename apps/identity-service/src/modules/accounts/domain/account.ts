export type ActorType = "customer" | "employee";

export type Account = {
  id: string;
  actorType: ActorType;
  /** A deactivated account keeps its history but must never surface in a counter lookup. */
  isActive: boolean;
  email: string;
  /** A shopkeeper calls this number to confirm a prescription order, so it is the account holder's own contact. */
  phoneNumber?: string | undefined;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt?: Date;
  roles: string[];
  siteIds: string[];
  /** Set by an administrator's password set (create or reset). Requests are refused until the holder changes it. */
  mustChangePassword: boolean;
  createdAt: Date;
};

/**
 * The customer identity a counter lookup may hand out. It deliberately carries no password hash, role, or site
 * scope, because everyone behind the counter who may search needs the phone to call back and nothing else.
 */
export type CustomerMatch = {
  id: string;
  displayName: string;
  email: string;
  phoneNumber: string | null;
};
