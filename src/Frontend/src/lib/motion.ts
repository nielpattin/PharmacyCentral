import type { Transition, Variants } from "motion/react";

export const motionTimings = {
   quick: 0.16,
   standard: 0.22,
   deliberate: 0.32,
} as const;

export const motionEase = [0.2, 0, 0, 1] as const;

export const motionTransition = {
   quick: { duration: motionTimings.quick, ease: motionEase } satisfies Transition,
   standard: { duration: motionTimings.standard, ease: motionEase } satisfies Transition,
   deliberate: { duration: motionTimings.deliberate, ease: motionEase } satisfies Transition,
   layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.8 } satisfies Transition,
} as const;

export const pageVariants = {
   initial: { opacity: 0, y: 10 },
   animate: {
      opacity: 1,
      y: 0,
      transition: motionTransition.standard,
   },
   exit: {
      opacity: 0,
      y: -6,
      transition: motionTransition.quick,
   },
} satisfies Variants;

export const sectionVariants = {
   initial: { opacity: 0 },
   animate: {
      opacity: 1,
      transition: {
         ...motionTransition.standard,
         staggerChildren: 0.045,
         delayChildren: 0.025,
      },
   },
} satisfies Variants;

export const cardVariants = {
   initial: { opacity: 0, y: 12, scale: 0.985 },
   animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: motionTransition.standard,
   },
   exit: {
      opacity: 0,
      y: 8,
      scale: 0.99,
      transition: motionTransition.quick,
   },
} satisfies Variants;

export const rowVariants = {
   initial: { opacity: 0, x: -8 },
   animate: {
      opacity: 1,
      x: 0,
      transition: motionTransition.quick,
   },
   exit: {
      opacity: 0,
      x: 8,
      transition: motionTransition.quick,
   },
} satisfies Variants;

export const panelVariants = {
   initial: { opacity: 0, y: 8 },
   animate: {
      opacity: 1,
      y: 0,
      transition: motionTransition.standard,
   },
   exit: {
      opacity: 0,
      y: -8,
      transition: motionTransition.quick,
   },
} satisfies Variants;

export const activeIndicatorTransition = motionTransition.layout;

export const motionInteractions = {
   hoverLift: { y: -2, transition: motionTransition.quick },
   tapPress: { scale: 0.985, transition: motionTransition.quick },
} as const;
