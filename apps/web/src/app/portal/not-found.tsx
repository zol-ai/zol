/**
 * An expired, revoked or mistyped link.
 *
 * Says nothing about which: a link that leaks should not confirm whether it
 * was ever real. The only useful next step is the shop, and the customer has
 * the shop's number in the text this link arrived in.
 */
export default function PortalNotFound() {
  return (
    <div className="card mx-auto mt-8 max-w-md p-6 text-center sm:p-8">
      <p className="t-eyebrow">Repair page</p>
      <h1 className="t-h2 mt-2 text-[1.5rem]">This link isn&apos;t active</h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-2">
        Links to a repair page stop working after a while, and each new message from the
        shop carries a fresh one. Check the most recent text from the shop, or give them a
        call and they&apos;ll send another.
      </p>
    </div>
  );
}
