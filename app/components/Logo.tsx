export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`logo-wordmark ${className}`} aria-label="fraym">
      <span style={{ color: "#FF5C35" }}>f</span>raym
    </span>
  );
}
