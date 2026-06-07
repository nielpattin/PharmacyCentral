import { motion, type HTMLMotionProps } from "motion/react";
import { cardVariants, motionInteractions } from "../../lib/motion";
import { cn } from "../../lib/utils";

type MotionCardProps = HTMLMotionProps<"div"> & {
   interactive?: boolean;
};

export function MotionCard({ className, interactive = false, ...props }: MotionCardProps) {
   return (
      <motion.div
         variants={cardVariants}
         whileHover={interactive ? motionInteractions.hoverLift : undefined}
         whileTap={interactive ? motionInteractions.tapPress : undefined}
         className={cn("min-w-0", className)}
         {...props}
      />
   );
}
