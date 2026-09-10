export type ActorType = "customer" | "employee";

export type Account = {
  id: string;
  actorType: ActorType;
  email: string;
  displayName: string;
  passwordHash: string;
  emailVerifiedAt?: Date;
  roles: string[];
  siteIds: string[];
  createdAt: Date;
};
