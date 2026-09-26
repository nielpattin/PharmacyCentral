export type ActorType = "customer" | "employee";

export type Account = {
  id: string;
  actorType: ActorType;
  email: string;
  /** A shopkeeper calls this number to confirm a prescription order, so it is the account holder's own contact. */
  phoneNumber?: string | undefined;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt?: Date;
  roles: string[];
  siteIds: string[];
  createdAt: Date;
};
