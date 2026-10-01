/** Decorative CSS-only 3D envelope. Static under reduced motion and on small screens. */
export function Envelope3D({ className = "" }: { className?: string }) {
  return (
    <div className={`envelope-scene ${className}`} aria-hidden>
      <div className="envelope">
        <div className="envelope__letter" />
        <div className="envelope__body" />
        <div className="envelope__flap" />
        <div className="envelope__shadow" />
      </div>
    </div>
  );
}
