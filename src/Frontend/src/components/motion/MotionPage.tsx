import { motion, type HTMLMotionProps } from "motion/react";
import { pageVariants } from "../../lib/motion";
import { cn } from "../../lib/utils";

type MotionPageProps = HTMLMotionProps<"div">;

export function MotionPage({ className, ...props }: MotionPageProps) {
   return (
      <motion.div
         variants={pageVariants}
         initial="initial"
         animate="animate"
         exit="exit"
         className={cn("min-w-0", className)}
         {...props}
      />
   );
}
