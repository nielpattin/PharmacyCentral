import { motion, type HTMLMotionProps } from "motion/react";
import { sectionVariants } from "../../lib/motion";
import { cn } from "../../lib/utils";

type MotionSectionProps = HTMLMotionProps<"section">;

export function MotionSection({ className, ...props }: MotionSectionProps) {
   return (
      <motion.section
         variants={sectionVariants}
         initial="initial"
         animate="animate"
         className={cn("min-w-0", className)}
         {...props}
      />
   );
}
