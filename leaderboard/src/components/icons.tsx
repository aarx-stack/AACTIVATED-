/** Hand-rolled 24px stroke icons — consistent weight, zero dependencies. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconTrophy = (p: P) => (
  <I {...p}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5" />
  </I>
);

export const IconCrown = (p: P) => (
  <I {...p}>
    <path d="M4 17 3 7l5 3 4-6 4 6 5-3-1 10H4Z" />
  </I>
);

export const IconArrowUp = (p: P) => (
  <I {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </I>
);

export const IconArrowDown = (p: P) => (
  <I {...p}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </I>
);

export const IconSearch = (p: P) => (
  <I {...p}>
    <circle cx={11} cy={11} r={7} />
    <path d="m20 20-3.2-3.2" />
  </I>
);

export const IconShield = (p: P) => (
  <I {...p}>
    <path d="M12 3 5 6v6c0 4.4 3 7.5 7 9 4-1.5 7-4.6 7-9V6l-7-3Z" />
  </I>
);

export const IconCheck = (p: P) => (
  <I {...p}>
    <path d="m5 13 4 4L19 7" />
  </I>
);

export const IconClock = (p: P) => (
  <I {...p}>
    <circle cx={12} cy={12} r={9} />
    <path d="M12 7v5l3 3" />
  </I>
);

export const IconWarning = (p: P) => (
  <I {...p}>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4M12 17.3v.2" />
  </I>
);

export const IconUsers = (p: P) => (
  <I {...p}>
    <circle cx={9} cy={8.5} r={3.5} />
    <path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6M18.5 14.8c1.7.8 2.8 2.3 3 5.2" />
  </I>
);

export const IconUser = (p: P) => (
  <I {...p}>
    <circle cx={12} cy={8} r={4} />
    <path d="M4.5 20.5c.8-4 3.9-6 7.5-6s6.7 2 7.5 6" />
  </I>
);

export const IconSync = (p: P) => (
  <I {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6M20 3.5V8h-4.5" />
  </I>
);

export const IconBolt = (p: P) => (
  <I {...p}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </I>
);

export const IconChevronL = (p: P) => (
  <I {...p}>
    <path d="m14.5 5-6 7 6 7" />
  </I>
);

export const IconChevronR = (p: P) => (
  <I {...p}>
    <path d="m9.5 5 6 7-6 7" />
  </I>
);

export const IconChevronD = (p: P) => (
  <I {...p}>
    <path d="m5 9.5 7 6 7-6" />
  </I>
);

export const IconExport = (p: P) => (
  <I {...p}>
    <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
    <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
  </I>
);

export const IconSettings = (p: P) => (
  <I {...p}>
    <circle cx={12} cy={12} r={3.2} />
    <path d="M19 12c0-.6.5-1.2 1-1.6l-1.2-2.8c-.7.2-1.4.1-1.9-.4s-.6-1.2-.4-1.9L13.7 4c-.4.6-1 1-1.7 1s-1.3-.4-1.7-1L7.5 5.3c.2.7.1 1.4-.4 1.9s-1.2.6-1.9.4L4 10.4c.5.4 1 1 1 1.6s-.5 1.2-1 1.6l1.2 2.8c.7-.2 1.4-.1 1.9.4s.6 1.2.4 1.9l2.8 1.3c.4-.6 1-1 1.7-1s1.3.4 1.7 1l2.8-1.3c-.2-.7-.1-1.4.4-1.9s1.2-.6 1.9-.4l1.2-2.8c-.5-.4-1-1-1-1.6Z" />
  </I>
);

export const IconLedger = (p: P) => (
  <I {...p}>
    <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </I>
);

export const IconTree = (p: P) => (
  <I {...p}>
    <rect x={9} y={3} width={6} height={5} rx={1} />
    <rect x={3} y={16} width={6} height={5} rx={1} />
    <rect x={15} y={16} width={6} height={5} rx={1} />
    <path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
  </I>
);

export const IconEye = (p: P) => (
  <I {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx={12} cy={12} r={3} />
  </I>
);

export const IconX = (p: P) => (
  <I {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </I>
);

export const IconCalendar = (p: P) => (
  <I {...p}>
    <rect x={3.5} y={5} width={17} height={16} rx={2} />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
  </I>
);

export const IconFlag = (p: P) => (
  <I {...p}>
    <path d="M5 21V4" />
    <path d="M5 4c4-2.2 7 2 12 0v9c-5 2.2-8-2-12 0" />
  </I>
);

export const IconLock = (p: P) => (
  <I {...p}>
    <rect x={5} y={11} width={14} height={10} rx={2} />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </I>
);

export const IconMinus = (p: P) => (
  <I {...p}>
    <path d="M6 12h12" />
  </I>
);

export const IconSparkle = (p: P) => (
  <I {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
  </I>
);
