import type { ReactNode } from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { rowVariants, sectionVariants } from "../../lib/motion";
import { cn } from "../../lib/utils";

type MotionListProps = Omit<HTMLMotionProps<"div">, "children"> & {
   children?: ReactNode;
   mode?: "sync" | "wait" | "popLayout";
};

type MotionListItemProps = HTMLMotionProps<"div">;

export function MotionList({ className, mode = "popLayout", children, ...props }: MotionListProps) {
   return (
      <motion.div
         variants={sectionVariants}
         initial="initial"
         animate="animate"
         className={cn("min-w-0", className)}
         {...props}
      >
         <AnimatePresence mode={mode}>{children}</AnimatePresence>
      </motion.div>
   );
}

export function MotionListItem({ className, ...props }: MotionListItemProps) {
   return (
      <motion.div
         layout
         variants={rowVariants}
         initial="initial"
         animate="animate"
         exit="exit"
         className={cn("min-w-0", className)}
         {...props}
      />
   );
}
