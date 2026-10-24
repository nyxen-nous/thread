import { useEffect, useId, useRef, useState } from 'react';
import { art } from './art';
import { onCurve, sampleTransfer, TRANSFER_START, TRANSFER_END, TOUR_LENGTH } from './model';
import './iso.css';
import './transfer-figure.css';

const phases = [
  { title: 'Share a link', text: 'Pick a file and send your private link. The file stays on your laptop.' },
  { title: 'Approve', text: 'Compare the connection code, then approve the person who wants to connect.' },
  { title: 'Send directly', text: 'Once the recipient chooses where to save, encrypted file pieces travel between the two browsers.' },
  { title: 'Delivered', text: 'The recipient checks the chunks and the final digest chain before confirming the file arrived.' },
] as const;
type Playback = 'play' | 'pause' | 'step';

export function TransferFigure() {
  const [playback, setPlayback] = useState<Playback>('play');
  const [phase, setPhase] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [revision, setRevision] = useState(0);
  const root = useRef<HTMLElement>(null);
  const pieces = useRef<(SVGGElement | null)[]>([]);
  const progress = useRef<SVGRectElement>(null);
  const completion = useRef<SVGGElement>(null);
  const document = useRef<SVGGElement>(null);
  const approval = useRef<SVGGElement>(null);
  const route = useRef<SVGPathElement>(null);
  const screenStatus = useRef<SVGTextElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const clock = useRef(0);
  const clip = useId().replace(/:/g, '');
  const middle = onCurve(art.curve, .5);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0, visible = false, current = -1;
    const draw = () => {
      const state = sampleTransfer(clock.current);
      if (state.phase !== current) { current = state.phase; setPhase(current); }
      state.pieces.forEach((piece, i) => {
        const point = onCurve(art.curve, piece.at);
        pieces.current[i]?.setAttribute('transform', `translate(${point[0]} ${point[1]}) rotate(-6)`);
        pieces.current[i]?.setAttribute('opacity', String(piece.opacity));
      });
      progress.current?.setAttribute('width', String(26 * state.progress));
      completion.current?.setAttribute('opacity', state.complete ? '1' : '0');
      document.current?.setAttribute('opacity', state.complete ? '0' : state.phase < 2 ? '.25' : '1');
      approval.current?.setAttribute('opacity', state.phase === 1 ? '1' : '0');
      route.current?.setAttribute('opacity', state.phase >= 2 ? '.8' : '.25');
      if (screenStatus.current) screenStatus.current.textContent = ['Waiting', 'Awaiting approval', `${Math.round(state.progress*100)}% received`, 'Received'][state.phase];
      if (readout.current) readout.current.textContent = ['Your file stays with you', 'You choose who connects', `${state.arrived} of 6 demo pieces received`, 'Delivered. Checked. Done.'][state.phase];
      return state;
    };
    const shouldAdvance = () => !media.matches && (playback === 'play' || playback === 'step' && sampleTransfer(clock.current).phase === 2);
    const tick = (now: number) => {
      frame = 0;
      const dt = last ? Math.min((now-last)/1000, .05) : 0;
      last = now;
      if (shouldAdvance()) {
        clock.current += dt;
        if (playback === 'play') clock.current %= TOUR_LENGTH;
        else clock.current = Math.min(clock.current, TRANSFER_END);
      }
      draw();
      if (visible && !window.document.hidden && shouldAdvance()) frame = requestAnimationFrame(tick);
    };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; };
    const run = () => { if (visible && !window.document.hidden && !frame && shouldAdvance()) { last = 0; frame = requestAnimationFrame(tick); } };
    const observer = new IntersectionObserver(entries => {
      visible = entries[entries.length-1].isIntersecting;
      if (visible) run(); else stop();
    });
    if (root.current) observer.observe(root.current);
    const visibility = () => { if (window.document.hidden) stop(); else run(); };
    const motion = () => { setReduced(media.matches); stop(); draw(); run(); };
    setReduced(media.matches);
    draw();
    window.document.addEventListener('visibilitychange', visibility);
    media.addEventListener('change', motion);
    return () => { stop(); observer.disconnect(); window.document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', motion); };
  }, [playback, revision]);

  function selectStep(index: number) {
    clock.current = [1, 3.5, reduced ? 7.5 : TRANSFER_START, 11.5][index];
    setPhase(index); setPlayback('step'); setRevision(v => v+1);
  }
  const playing = playback === 'play' && !reduced || playback === 'step' && phase === 2 && !reduced;

  return <figure className="thread-anatomy iso" data-theme="light" ref={root} aria-label="Interactive laptop-to-phone sharing illustration">
    <div className="transfer-plate iso-plate">
      <div className="transfer-figure-heading"><div><span className="transfer-eyebrow">A DIRECT CONNECTION</span><h2>Your file, on its way.</h2></div><button className="demo-play" disabled={reduced} onClick={() => { if (playing) setPlayback('pause'); else { if (clock.current >= TRANSFER_END) clock.current=0; setPlayback('play'); } }} aria-label={reduced ? 'Animation disabled by reduced motion preference' : playing ? 'Pause demo' : 'Play demo'}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">{playing ? <path d="M5 3v10M11 3v10" fill="none" stroke="currentColor" strokeWidth="1.8"/> : <path d="m5 3 8 5-8 5Z" fill="currentColor"/>}</svg><span>{reduced ? 'Still demo' : playing ? 'Pause' : 'Play'}</span></button></div>
      <svg className="iso-svg device-scene" viewBox="0 0 720 350" role="img" aria-labelledby={`${clip}-title ${clip}-desc`}>
        <title id={`${clip}-title`}>A private file moving from a laptop to a phone</title>
        <desc id={`${clip}-desc`}>Small file pieces follow a direct connection. The phone shows progress, then a check mark when the demo is complete. This is an illustration, not your live transfer.</desc>
        <g dangerouslySetInnerHTML={{ __html: art.devices }}/>
        <path ref={route} d={art.route} fill="none" stroke="#7e9470" strokeWidth="1.3" strokeDasharray="2 6" strokeLinecap="round" opacity=".25"/>
        {[0,3].map(i => <circle key={i} cx={art.curve[i][0]} cy={art.curve[i][1]} r="2.2" fill="#8a9b7c" opacity=".6"/>)}
        <g ref={approval} transform={`translate(${middle[0]} ${middle[1]})`} opacity="0" className="demo-approval"><circle r="12" fill="#fbfcf8" stroke="#bac8b0" strokeWidth=".8"/><rect x="-4" y="-1" width="8" height="6.5" rx="1.5" fill="none" stroke="#5e7550" strokeWidth="1"/><path d="M-2.5-1v-2a2.5 2.5 0 0 1 5 0v2" stroke="#5e7550" fill="none" strokeWidth="1"/></g>
        {Array.from({length:6},(_,i) => <g key={i} ref={node => { pieces.current[i]=node; }} opacity="0"><path d="M-6-9H1L6-4V8Q6 10 4 10H-4Q-6 10-6 8Z" fill="#fcfdf9" stroke="#738a61" strokeWidth=".8"/><path d="M1-9v5h5M-3 1h6M-3 4h4" fill="none" stroke="#91a381" strokeWidth=".65" strokeLinecap="round"/></g>)}
        <g transform={art.phoneFace}>
          <defs><clipPath id={clip}><rect x="3.5" y="18" width="37" height="53" rx="2"/></clipPath></defs>
          <g clipPath={`url(#${clip})`}>
            <g ref={document} opacity=".25"><rect x="14" y="26" width="16" height="21" rx="2" fill="#fff" stroke="#a7b49b" strokeWidth=".5"/><path d="M24 26v6h6M18 37h8M18 41h6" fill="none" stroke="#90a17e" strokeWidth=".65"/></g>
            <g ref={completion} opacity="0" className="demo-completion"><circle cx="22" cy="36.5" r="9" fill="#557744"/><path d="m18 36.5 2.7 2.8 5.6-5.8" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></g>
            <rect x="9" y="54" width="26" height="1.7" rx=".85" fill="#d2ddc8"/><rect ref={progress} x="9" y="54" width="0" height="1.7" rx=".85" fill="#698456"/>
            <text ref={screenStatus} x="22" y="64" textAnchor="middle" fill="#5c7050" fontSize="3.7" fontFamily="Arial,sans-serif">Waiting</text>
          </g>
        </g>
        <text x={art.laptopLabel[0]} y={art.laptopLabel[1]} textAnchor="middle" className="device-label">Your laptop</text><text x={art.phoneLabel[0]} y={art.phoneLabel[1]} textAnchor="middle" className="device-label">Their phone</text>
      </svg>
      <div className="transfer-figure-foot"><span className="demo-status"><span className={phase===3 ? 'demo-dot is-done' : 'demo-dot'}/><span ref={readout}>Your file stays with you</span></span><span className="demo-tag">ILLUSTRATION</span></div>
    </div>
    <div className="transfer-steps" role="group" aria-label="Explore sharing steps">{phases.map((step,i) => <button key={step.title} className={phase===i?'is-current':''} aria-pressed={phase===i} onClick={()=>selectStep(i)}><span>0{i+1}</span>{step.title}</button>)}</div>
    <figcaption><p className="transfer-caption" aria-live="polite" aria-atomic="true"><strong>{phases[phase].title}.</strong> {phases[phase].text}</p><p className="transfer-disclaimer">Just a demo. Your real files travel directly between browsers after approval. Keep both tabs open.</p></figcaption>
  </figure>;
}
