import { useRef, useState } from 'react';

const UPI_ID = '8826063243@fam';
const PAYMENT_URL = `upi://pay?${new URLSearchParams({ pa: UPI_ID, pn: 'Sammi Zafar', cu: 'INR', tn: 'Support Thread' }).toString()}`;

export function CoffeeSupport() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(UPI_ID); setStatus('UPI ID copied.'); }
    catch { setStatus('Select the UPI ID below and copy it manually.'); }
  }
  return <>
    <button className="coffee-support" onClick={() => { setStatus(''); dialog.current?.showModal(); }}>
      <span aria-hidden="true">☕</span>Buy me a coffee
    </button>
    <dialog ref={dialog} className="coffee-dialog" aria-labelledby="coffee-title" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="coffee-content">
        <button className="coffee-close icon-button" aria-label="Close support dialog" onClick={() => dialog.current?.close()}>×</button>
        <span className="coffee-eyebrow">SUPPORT THE MAKER</span>
        <h2 id="coffee-title">Enjoying Thread?</h2>
        <p>Your support helps me keep building. Sharing files is always available without a tip.</p>
        <img className="coffee-qr" src="/support-upi.svg" width="232" height="232" alt="UPI payment QR for 8826063243@fam" />
        <p className="small">Scan with a UPI app and choose your amount.</p>
        <label className="small" htmlFor="coffee-upi">Pay directly via UPI</label>
        <input id="coffee-upi" className="coffee-upi" value={UPI_ID} readOnly onFocus={e => e.target.select()} />
        <div className="coffee-actions"><a className="primary" href={PAYMENT_URL}>Open UPI app</a><button className="secondary" onClick={() => void copy()}>Copy UPI ID</button></div>
        <p className="small">Mobile app support varies. If the button doesn’t open your app, use the QR or copy the ID. Check the recipient shown in your UPI app before paying.</p>
        <p className="small">Thread cannot confirm payments. Your payment app provides the receipt.</p>
        <p role="status" aria-live="polite" className="small coffee-status">{status}</p>
      </div>
    </dialog>
  </>;
}
