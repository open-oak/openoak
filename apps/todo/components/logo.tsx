export default function Logo({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="2" y="2" width="44" height="44" rx="12" fill="none" />
      <rect x="2" y="2" width="44" height="44" rx="12" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
      <path
        d="M15 25L21 31L33 18"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <line x1="15" y1="36" x2="33" y2="36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="15" y1="40" x2="26" y2="40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
    </svg>
  );
}
