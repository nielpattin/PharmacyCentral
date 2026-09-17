import { cn } from "@pharmacy/ui";

type IconProps = { className?: string | undefined };

const Svg = ({
  className,
  children,
}: {
  className?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn("size-5 shrink-0", className)}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconSearch = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Svg>
);

export const IconCart = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M2 3h2.4l2.5 11.4a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.8L20 7H5.2" />
    <circle cx="9.5" cy="19.5" r="1.4" />
    <circle cx="17.5" cy="19.5" r="1.4" />
  </Svg>
);

export const IconUser = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);

export const IconMenu = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </Svg>
);

export const IconCheck = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Svg>
);

export const IconCross = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5V3Z" />
  </Svg>
);

export const IconTruck = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M2 6.5h10.5v9H2zM12.5 10h4l3.5 3.5v2h-7.5z" />
    <circle cx="6" cy="18" r="1.7" />
    <circle cx="16.5" cy="18" r="1.7" />
  </Svg>
);

export const IconStore = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M3.5 9 5.5 4h13l2 5" />
    <path d="M4.5 9h15v11h-15z" />
    <path d="M9.5 20v-6h5v6" />
  </Svg>
);

export const IconQr = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <rect x="3" y="3" width="7" height="7" rx="1.2" />
    <rect x="14" y="3" width="7" height="7" rx="1.2" />
    <rect x="3" y="14" width="7" height="7" rx="1.2" />
    <path d="M14 14h3v3h-3zM20.5 20.5h.5M20.5 14h.5M14 20.5h.5" />
  </Svg>
);

export const IconChevronRight = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);

export const IconPin = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21Z" />
    <circle cx="12" cy="10.5" r="2.4" />
  </Svg>
);

export const IconShield = ({ className }: IconProps): React.JSX.Element => (
  <Svg className={className}>
    <path d="M12 3l7 2.6v5.2c0 4.3-2.9 8.1-7 9.2-4.1-1.1-7-4.9-7-9.2V5.6L12 3Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
