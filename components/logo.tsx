export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" className={className} aria-label="SaaS Soft logo">
      <rect width="36" height="36" rx="9" fill="#4f46e5" />
      {/* Top-right filled square */}
      <rect x="19" y="7" width="10" height="10" rx="2.5" fill="white" />
      {/* Bottom-left filled square */}
      <rect x="7" y="19" width="10" height="10" rx="2.5" fill="white" />
      {/* Top-left outlined square */}
      <rect x="7" y="7" width="10" height="10" rx="2.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.4" />
      {/* Bottom-right outlined square */}
      <rect x="19" y="19" width="10" height="10" rx="2.5" stroke="white" strokeWidth="1.5" strokeOpacity="0.4" />
    </svg>
  );
}
