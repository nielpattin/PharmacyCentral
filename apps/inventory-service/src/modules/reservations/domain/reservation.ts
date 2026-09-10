export type ReservationStatus = "active" | "released" | "consumed" | "rejected";

export type Reservation = {
  id: string;
  ownerId: string;
  status: ReservationStatus;
};

export const transitionReservation = (
  current: ReservationStatus,
  next: Exclude<ReservationStatus, "rejected">,
): ReservationStatus => {
  if (current === "active" && ["released", "consumed"].includes(next)) return next;
  if (current === next) return current;
  throw new Error(`Invalid reservation transition: ${current} -> ${next}`);
};
