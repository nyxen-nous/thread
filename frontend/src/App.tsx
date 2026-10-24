import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Session, apiUrl, initialSnapshot } from './session';
import type { Snapshot } from './session';
import { canSaveToDisk, createSink } from './storage';
import { MEMORY_LIMIT, formatBytes, safeFilename } from './protocol';

type IconName = 'send' | 'link' | 'file' | 'check' | 'close' | 'arrow' | 'shield' | 'help' | 'lock' | 'download' | 'copy' | 'plus' | 'laptop' | 'menu';
function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    send: <><path d="m21 3-7 18-4-7-7-4 18-7Z"/><path d="m10 14 5-5"/></>,
    link: <><path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8m-8 4h5"/></>,
    check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M18 6 6 18"/>, arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    laptop: <><rect x="4" y="4" width="16" height="12" rx="2"/><path d="m4 16-2 4h20l-2-4"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Brand() { return <span className="brand"><svg viewBox="0 0 36 36" aria-hidden="true"><path d="M7 26V12a5 5 0 0 1 10 0v12a5 5 0 0 0 10 0V10"/><circle cx="7" cy="26" r="2.4"/><circle cx="27" cy="10" r="2.4"/></svg>thread<span className="brand-period">.</span></span>; }

const help = [
  ['What happens to my file?', 'It stays on your device until the recipient downloads it. The two browsers exchange file chunks directly. Our connection service introduces the browsers; it does not store or relay your file.'],
  ['Does the sender need to stay online?', 'Yes. Keep both tabs open and both devices awake. Closing a tab or losing the connection can interrupt the transfer. This first release does not resume interrupted downloads.'],
  ['How big can a file be?', 'There is no application size cap in direct-to-disk mode on supported browsers. Other browsers use a memory download limited to 64 MiB. Device storage, browser capabilities and network stability still apply.'],
  ['Why can’t the devices connect?', 'Some mobile, corporate and campus networks block direct connections. Try another network on either end, such as a home connection or phone hotspot. Thread does not use a file relay.'],
  ['How long does the link last?', 'Up to four hours from creation, or until the sender closes the tab or ends the share. A restart of the connection service can also end a share.'],
  ['What does “verified” mean?', 'The receiver checks a SHA-256 digest for every chunk and a final digest chain, then confirms the bytes are saved to disk or ready to save in memory mode. This checks the transferred bytes; it does not identify a person or scan a file for malware.'],
  ['Can several people download?', 'This first release allows one recipient at a time. After a recipient disconnects, another person with the link can request approval while the sender keeps the share open.'],
];

export function App() {
  const route = location.pathname;
  const isReceiver = route.startsWith('/s/');
  const [view, setView] = useState<'send' | 'help' | 'privacy'>(route === '/how-it-works' ? 'help' : route === '/privacy' ? 'privacy' : 'send');
  const [navOpen, setNavOpen] = useState(false);
  const [file, setFile] = useState<File>();
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [localError, setLocalError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [server, setServer] = useState<'checking' | 'online' | 'offline'>('checking');
  const [checking, setChecking] = useState(false);
  const session = useRef<Session | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const downloadUrl = useRef<string | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = !['idle', 'ended', 'error', 'canceled'].includes(snapshot.stage);
  const terminal = ['complete', 'error', 'canceled', 'ended'].includes(snapshot.stage);
  const meta = isReceiver ? snapshot.file : file ? { name: file.name, size: file.size } : undefined;
  const percent = meta?.size ? Math.min(100, snapshot.bytes / meta.size * 100) : snapshot.stage === 'complete' ? 100 : 0;
  const disk = canSaveToDisk();
  const blockedSize = isReceiver && !!meta && !disk && meta.size > MEMORY_LIMIT;

  async function checkServer() {
    setChecking(true);
    try { const r = await fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(8000), cache: 'no-store' }); const data = await r.json(); setServer(r.ok && data.service === 'thread' ? 'online' : 'offline'); }
    catch { setServer('offline'); }
    finally { setChecking(false); }
  }
  useEffect(() => { void checkServer(); return () => { session.current?.stop(); clearTimeout(copyTimer.current); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }; }, []);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    if (active && snapshot.stage !== 'complete') window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [active, snapshot.stage]);

  function onSnapshot(patch: Partial<Snapshot>) {
    if (patch.downloadUrl) { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = patch.downloadUrl; }
    setSnapshot(previous => ({ ...previous, ...patch }));
  }
  function select(files: FileList | null) {
    setLocalError(''); if (!files?.length) return;
    if (files.length !== 1) { setLocalError('Choose one file for this share. You can zip a folder before selecting it.'); return; }
    setFile(files[0]);
  }
  async function start() {
    setLocalError(''); session.current?.stop(); setSnapshot({ ...initialSnapshot, stage: 'starting' });
    const client = new Session(onSnapshot, isReceiver ? undefined : file); session.current = client;
    if (isReceiver) await client.start(route.split('/')[2], location.hash.slice(1)); else if (file) await client.start();
  }
  function reset() {
    session.current?.stop(); session.current = undefined;
    if (downloadUrl.current) { URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = undefined; }
    setSnapshot(initialSnapshot); setLocalError(''); setCopied(false);
  }
  async function copy() {
    if (!snapshot.link) return;
    try { await navigator.clipboard.writeText(snapshot.link); setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2200); }
    catch { linkInput.current?.select(); setLocalError('Select the link and copy it with your keyboard.'); }
  }
  async function save() {
    if (!snapshot.file || !session.current) return;
    setPicking(true); setLocalError('');
    try { const sink = await createSink(snapshot.file); session.current.receive(sink); }
    catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setLocalError(e instanceof Error ? e.message : 'Could not open the download destination.'); }
    finally { setPicking(false); }
  }
  function nav(next: 'send' | 'help' | 'privacy') { setView(next); setNavOpen(false); }

  const headings: Record<Snapshot['stage'], string> = {
    idle: isReceiver ? 'Receive a file' : 'Send a file', starting: 'Opening a private connection', sharing: 'Your link is ready',
    approval: isReceiver ? 'Waiting for the sender' : 'A recipient wants to connect', connecting: 'Connecting your devices',
    ready: isReceiver ? 'Ready when you are' : 'Your recipient is connected', transferring: isReceiver ? 'Receiving your file' : 'Sending your file',
    verifying: 'Finishing the download', complete: 'Delivered. And verified.', canceled: 'Transfer canceled', error: 'Let’s get you connected', ended: 'This share has ended',
  };

  return <div className="app-shell">
    <aside className={`sidebar ${navOpen ? 'is-open' : ''}`}>
      <button className="brand-button" onClick={() => nav('send')} aria-label="Thread home"><Brand /></button>
      <button className="mobile-menu icon-button" onClick={() => setNavOpen(!navOpen)} aria-label="Toggle navigation" aria-expanded={navOpen}><Icon name={navOpen ? 'close' : 'menu'} /></button>
      <nav aria-label="Main navigation">
        <button className={view === 'send' ? 'nav-item selected' : 'nav-item'} onClick={() => nav('send')}><Icon name={isReceiver ? 'download' : 'send'} />{isReceiver ? 'Receive a file' : 'Send a file'}</button>
        <button className={view === 'help' ? 'nav-item selected' : 'nav-item'} onClick={() => nav('help')}><Icon name="help" />How it works</button>
        <button className={view === 'privacy' ? 'nav-item selected' : 'nav-item'} onClick={() => nav('privacy')}><Icon name="shield" />Privacy</button>
      </nav>
      <div className="sidebar-note"><Icon name="link" size={20} /><p>A direct line<br/>between devices.</p><span>No account. No file storage.</span></div>
    </aside>
    <main>
      {view === 'send' ? <>
        <header className="page-header"><div><h1>{headings[snapshot.stage]}</h1><p>{isReceiver ? 'A file, shared directly with you.' : 'From your device to theirs. With a private link.'}</p></div><span className="release-label">Early version</span></header>
        <div className="workspace">
          <section className="transfer-panel" aria-label={isReceiver ? 'Receive file' : 'Send file'}>
            {snapshot.stage === 'idle' && !isReceiver && <>
              <div className={`dropzone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); select(e.dataTransfer.files); }}>
                <input ref={picker} type="file" className="visually-hidden" onChange={e => select(e.target.files)} aria-label="Choose a file to share" />
                {file ? <><div className="file-glyph"><Icon name="file" size={42} /></div><h2 className="filename" title={file.name}>{file.name}</h2><p>{formatBytes(file.size)} · Ready to share</p><button className="text-button" onClick={() => { setFile(undefined); if (picker.current) picker.current.value = ''; }}>Choose a different file</button></> : <><div className="file-glyph"><Icon name="file" size={42} /><span className="file-plus"><Icon name="plus" size={16} /></span></div><h2>Drop a file here</h2><p>Or choose one from your device.</p><button className="secondary" onClick={() => picker.current?.click()}><Icon name="plus" />Choose a file</button></>}
              </div>
              <div className="panel-bottom"><div className="approval-note"><Icon name="shield" /><div><span>You decide who connects</span><small>Approve the recipient before anything is sent.</small></div></div><button className="primary full" disabled={!file} onClick={() => void start()}>Create private link<Icon name="arrow" /></button><p className="small centered">One file at a time. No upload to our server.</p></div>
            </>}
            {snapshot.stage === 'idle' && isReceiver && <div className="receiver-intro"><div className="file-glyph"><Icon name="download" size={42} /></div><h2>You’ve been sent a private link.</h2><p>Connect to the sender to see the file. Nothing downloads until you choose to receive it.</p><button className="primary" onClick={() => void start()}>Connect to sender<Icon name="arrow" /></button><p className="small">The sender will approve your connection.</p></div>}
            {snapshot.stage === 'starting' && <div className="working-state"><span className="spinner"/><h2>Opening your share</h2><p>The free connection service may take a moment to wake up.</p><button className="text-button" onClick={() => session.current?.stop()}>Cancel</button></div>}
            {snapshot.stage !== 'idle' && snapshot.stage !== 'starting' && <div className="session-panel">
              {meta && <div className="file-row"><Icon name="file" size={27}/><div><h2 className="filename" title={meta.name}>{meta.name}</h2><p>{formatBytes(meta.size)}</p></div>{snapshot.stage === 'complete' && <span className="verified"><Icon name="check"/>Verified</span>}</div>}
              {!isReceiver && snapshot.link && !['ended','error','canceled'].includes(snapshot.stage) && <div className="link-block"><label htmlFor="share-link">Your private link</label><div className="copy-field"><input ref={linkInput} id="share-link" value={snapshot.link} readOnly onFocus={e => e.target.select()}/><button onClick={() => void copy()} aria-label="Copy private link"><Icon name={copied ? 'check' : 'copy'}/>{copied ? 'Copied' : 'Copy'}</button></div><p className="small">Share the full link only with the person you’re sending to.</p></div>}
              {snapshot.stage === 'sharing' && <div className="status-block"><Icon name="link" size={24}/><h2>Waiting for your recipient</h2><p>Send the link, then keep this tab open. You’ll see their request here.</p></div>}
              {snapshot.stage === 'approval' && <div className="status-block"><Icon name="shield" size={24}/><h2>{isReceiver ? 'The sender is reviewing your request.' : 'Allow this recipient?'}</h2><p>Compare this connection code with the other person before continuing.</p><code className="verification-code">{snapshot.verification}</code>{!isReceiver && <div className="button-row"><button className="secondary" onClick={() => session.current?.decline()}>Decline</button><button className="primary" onClick={() => void session.current?.approve()}>Allow connection<Icon name="check"/></button></div>}</div>}
              {snapshot.stage === 'connecting' && <div className="status-block"><span className="spinner"/><h2>Finding a direct route</h2><p>Both devices need to stay online. This can take a few seconds.</p></div>}
              {snapshot.stage === 'ready' && <div className="status-block"><Icon name="lock" size={24}/><h2>{isReceiver ? 'Your file is ready to receive.' : 'Waiting for the download to start.'}</h2><p>{isReceiver ? (disk ? 'Choose a save location. The file will be written to disk as it arrives.' : 'This browser downloads in memory, with a 64 MiB limit.') : 'Your recipient chooses where to save it. The file stays on your device until then.'}</p>{isReceiver && meta && <button className="primary" disabled={blockedSize || picking} onClick={() => void save()}><Icon name="download"/>{picking ? 'Choosing a destination…' : disk ? 'Choose location & receive' : 'Receive file'}</button>}{blockedSize && <p className="inline-error">This file exceeds this browser’s 64 MiB limit. Use desktop Chrome or Edge for direct-to-disk saving.</p>}</div>}
              {['transferring','verifying','complete'].includes(snapshot.stage) && <div className="progress-block"><div className="progress-heading"><span>{snapshot.stage === 'complete' ? 'Transfer complete' : snapshot.stage === 'verifying' ? 'Verifying & saving' : isReceiver ? 'Receiving' : 'Sending'}</span><strong>{percent.toFixed(0)}<span>%</span></strong></div><div className="progress-track" role="progressbar" aria-label="File transfer progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(percent)}><div style={{ width: `${percent}%` }}/></div><div className="progress-detail"><span>{formatBytes(snapshot.bytes)} of {formatBytes(meta?.size ?? 0)}</span><span>{snapshot.stage === 'transferring' ? `${formatBytes(snapshot.speed)}/s` : snapshot.stage === 'complete' ? 'Every chunk checked' : 'Finishing…'}</span></div>{snapshot.stage === 'complete' && <div className="completion-note"><Icon name="shield"/><p>{isReceiver ? snapshot.downloadUrl ? 'Your file is verified and ready. Save it below before closing this tab.' : 'Your file was verified and saved to the location you chose.' : 'The recipient confirmed that all file bytes arrived and passed verification.'}</p></div>}{snapshot.downloadUrl && meta && <a className="primary download-link" href={snapshot.downloadUrl} download={safeFilename(meta.name)}><Icon name="download"/>Save verified file</a>}</div>}
              {['error','canceled','ended'].includes(snapshot.stage) && <div className="status-block"><Icon name={snapshot.stage === 'error' ? 'help' : 'close'} size={25}/><h2>{snapshot.stage === 'error' ? 'The transfer couldn’t continue.' : snapshot.stage === 'canceled' ? 'Nothing else will be sent.' : 'The private link is now closed.'}</h2><p>{snapshot.error || 'You can start again whenever you’re ready.'}</p><button className="primary" onClick={reset}>{isReceiver ? 'Try again' : 'Start a new share'}<Icon name="arrow"/></button></div>}
              {!terminal && <button className="text-button end-share" onClick={() => snapshot.stage === 'transferring' || snapshot.stage === 'verifying' ? session.current?.cancel() : session.current?.stop()}>{snapshot.stage === 'transferring' || snapshot.stage === 'verifying' ? 'Cancel transfer' : isReceiver ? 'Disconnect' : 'End share'}</button>}
              {snapshot.stage === 'complete' && <button className="text-button end-share" onClick={reset}>{isReceiver ? 'Disconnect' : 'Send another file'}</button>}
            </div>}
            {(snapshot.notice || localError) && <div className={`notice ${localError ? 'notice-error' : ''}`} role={localError ? 'alert' : 'status'}>{localError || snapshot.notice}</div>}
            <div className="panel-footer"><span><Icon name="lock" size={14}/>Encrypted in transit</span><span>No account needed</span></div>
          </section>
          <aside className="connection-rail">
            <section><h2>Your connection</h2><div className={`connection-map ${snapshot.connected ? 'connected' : ''}`}><div><Icon name="laptop" size={26}/><span>You</span></div><span className="connection-line"><Icon name="lock" size={13}/></span><div><Icon name="laptop" size={26}/><span>{isReceiver ? 'Sender' : 'Recipient'}</span></div></div><div className="connection-state"><span className={snapshot.connected ? 'live-dot connected-dot' : 'live-dot'}/>{snapshot.connected ? 'Direct connection established' : snapshot.stage === 'connecting' ? 'Finding a direct route' : 'Not connected yet'}</div><p className="small">File contents travel between devices, without passing through our server.</p></section>
            <section className="before-send"><h2>Before you {isReceiver ? 'receive' : 'send'}</h2><p><Icon name="laptop"/><span>Keep both tabs open and devices awake.</span></p><p><Icon name="link"/><span>Links close with the sender’s tab, or after four hours.</span></p><p><Icon name="shield"/><span>Only connect with someone you trust.</span></p><button className="text-button" onClick={() => nav('help')}>How sharing works<Icon name="arrow" size={14}/></button></section>
            <div className="service-state"><span className={`live-dot ${server === 'online' ? 'connected-dot' : ''}`}/><span>{server === 'online' ? 'Connection service ready' : server === 'checking' || checking ? 'Checking connection service…' : 'Connection service unavailable'}</span>{server === 'offline' && <button className="text-button" onClick={() => void checkServer()} disabled={checking}>Retry</button>}</div>
          </aside>
        </div>
        <footer className="workspace-footer"><p>Your files belong on your devices.</p><button onClick={() => nav('privacy')}>Read the privacy details<Icon name="arrow" size={14}/></button></footer>
        <div className="visually-hidden" role="status" aria-live="polite">{headings[snapshot.stage]}</div>
      </> : view === 'help' ? <section className="reading-view"><header className="page-header"><div><h1>How Thread works</h1><p>Two browsers. A private connection. Your file.</p></div></header><div className="reading-intro"><p>Choose a file, share a link, and approve the recipient. Thread helps your browsers meet. They handle the file transfer directly.</p></div>{help.map(([q,a]) => <details key={q} className="faq"><summary>{q}<Icon name="plus" size={16}/></summary><p>{a}</p></details>)}<button className="primary" onClick={() => nav('send')}>Back to your {isReceiver ? 'download' : 'share'}<Icon name="arrow"/></button></section> : <section className="reading-view"><header className="page-header"><div><h1>Privacy, in plain language</h1><p>What stays private, and what doesn’t.</p></div></header><div className="privacy-body"><h2>Your file stays between devices</h2><p>Thread does not upload, store or relay file contents on its server. The selected file is read in small pieces and sent over an encrypted WebRTC connection. Your recipient can keep and share the downloaded copy.</p><h2>The link is a secret</h2><p>The part after # is a randomly generated key. It stays in your browser and encrypts connection details. Share the full link carefully. Anyone who has it can request a connection; the sender decides whether to approve.</p><h2>What the service can see</h2><p>The connection service sees IP addresses, room identifiers, connection timing and encrypted messages. It keeps temporary room state in memory. Hosting and network providers may keep their own access logs. The other peer may learn your public IP address. No account does not mean complete anonymity.</p><h2>What we don’t add</h2><p>No analytics scripts, ads, cookies or account database are included in this app. Fonts are served with the app. Cloudflare STUN is configured by default to help find network routes and can see connectivity requests. A self-hosting operator can change or disable it.</p><h2>The limits of browser security</h2><p>Encryption cannot protect a file from malicious code served by a compromised app host or a compromised device. Thread is an early implementation, not an independently audited security product.</p><h2>When a share ends</h2><p>End the share, close the sender’s tab or wait for its four-hour lifetime to expire. The connection service removes its room state. Interruptions require restarting the file transfer in this version.</p></div><button className="primary" onClick={() => nav('send')}>Back to your {isReceiver ? 'download' : 'share'}<Icon name="arrow"/></button></section>}
    </main>
  </div>;
}
