/**
 * AudioBots website widget.
 *
 *   <script src="https://YOUR-HOST/widget.js" data-key="wk_..." async></script>
 *
 * Optional attributes: data-position="left|right", data-label="Talk to sales", data-open="true".
 * JavaScript API: window.AudioBots.open() / .close() / .start() / .end().
 *
 * Renders in a Shadow DOM (the host page's CSS can't touch it). The key is public; the AudioBots
 * API only accepts it from the websites allowed for this widget (Admin -> Widgets).
 */
import {
  ConnectionState, ParticipantKind, Room, RoomEvent, Track,
  type RemoteParticipant, type RemoteTrack, type TextStreamReader,
} from 'livekit-client';
import { STYLES } from './styles';

type Config = {
  name: string; title: string; buttonLabel: string; color: string; position: 'left' | 'right';
  captions: boolean; maxMinutes: number;
};
type Phase = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';
type AgentEvent = { type: string; state?: string; role?: string; text?: string; final?: boolean; message?: string };

const script = document.currentScript as HTMLScriptElement | null;

function ready(fn: () => void) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

const ICON_MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z"/></svg>';

class Widget {
  private cfg!: Config;
  private readonly key: string;
  private readonly api: string;
  private room: Room | null = null;
  private phase: Phase = 'idle';
  private agentState = '';
  private muted = false;
  private captions = new Map<string, { who: 'agent' | 'you'; text: string; final: boolean }>();
  private host!: HTMLElement;
  private ui!: {
    launcher: HTMLButtonElement; panel: HTMLElement; status: HTMLElement; captions: HTMLElement;
    call: HTMLButtonElement; mute: HTMLButtonElement; note: HTMLElement;
  };

  constructor(key: string, base: string) {
    this.key = key;
    this.api = `${base}/backend`;
  }

  async init() {
    try {
      const r = await fetch(`${this.api}/v1/widget/config?key=${encodeURIComponent(this.key)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        console.warn(`[AudioBots] widget disabled: ${body.message ?? `HTTP ${r.status}`}`);
        return;
      }
      this.cfg = await r.json();
    } catch (e) {
      console.warn('[AudioBots] could not reach the voice service', e);
      return;
    }
    const d = script?.dataset ?? {};
    if (d.position === 'left' || d.position === 'right') this.cfg.position = d.position;
    if (d.label) this.cfg.buttonLabel = d.label;
    this.render();
    if (d.open === 'true') this.open();
  }

  // ------------------------------------------------------------------ UI

  private render() {
    this.host = el('div', { id: 'audiobots-widget' });
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = el('style');
    style.textContent = STYLES;
    shadow.append(style);

    const root = el('div', { class: `ab ab-${this.cfg.position}` });
    root.style.setProperty('--ab-accent', this.cfg.color);

    const launcher = el('button', { class: 'ab-launcher', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }) as HTMLButtonElement;
    launcher.innerHTML = `${ICON_MIC}<span></span>`;
    launcher.querySelector('span')!.textContent = this.cfg.buttonLabel;
    launcher.addEventListener('click', () => (this.ui.panel.hidden ? this.open() : this.close()));

    const panel = el('div', { class: 'ab-panel', role: 'dialog', 'aria-label': this.cfg.title });
    panel.hidden = true;
    const head = el('div', { class: 'ab-head' });
    head.append(el('strong', {}, this.cfg.title));
    const close = el('button', { class: 'ab-icon', type: 'button', 'aria-label': 'Close' }) as HTMLButtonElement;
    close.innerHTML = ICON_CLOSE;
    close.addEventListener('click', () => this.close());
    head.append(close);

    const status = el('p', { class: 'ab-status', role: 'status', 'aria-live': 'polite' });
    const captions = el('div', { class: 'ab-captions', 'aria-live': 'polite' });
    captions.hidden = !this.cfg.captions;
    const note = el('p', { class: 'ab-note' });

    const controls = el('div', { class: 'ab-controls' });
    const call = el('button', { class: 'ab-call', type: 'button' }) as HTMLButtonElement;
    call.addEventListener('click', () => (this.phase === 'live' || this.phase === 'reconnecting' || this.phase === 'connecting' ? void this.end() : void this.start()));
    const mute = el('button', { class: 'ab-mute', type: 'button', 'aria-pressed': 'false' }, 'Mute') as HTMLButtonElement;
    mute.addEventListener('click', () => void this.toggleMute());
    controls.append(call, mute);

    const foot = el('p', { class: 'ab-foot' }, 'You are talking to an AI assistant.');
    panel.append(head, status, captions, note, controls, foot);
    root.append(panel, launcher);
    shadow.append(root);
    document.body.append(this.host);

    panel.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') this.close(); });
    this.ui = { launcher, panel, status, captions, call, mute, note };
    this.paint();
  }

  private statusText(): string {
    switch (this.phase) {
      case 'idle': return 'Press the button and speak. We reply in your language.';
      case 'connecting': return 'Connecting…';
      case 'reconnecting': return 'Connection dropped. Reconnecting…';
      case 'ended': return 'Call ended. Thanks for calling!';
      case 'error': return "The call couldn't start.";
      case 'live':
        return ({ listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…' } as Record<string, string>)[this.agentState]
          ?? 'Connected. Waiting for the assistant…';
    }
  }

  private paint() {
    const { status, call, mute, launcher, panel } = this.ui;
    status.textContent = this.statusText();
    const inCall = this.phase === 'live' || this.phase === 'reconnecting' || this.phase === 'connecting';
    call.textContent = inCall ? 'End call' : this.phase === 'ended' ? 'Call again' : 'Start call';
    call.classList.toggle('ab-end', inCall);
    mute.hidden = this.phase !== 'live';
    mute.textContent = this.muted ? 'Unmute' : 'Mute';
    mute.setAttribute('aria-pressed', String(this.muted));
    launcher.setAttribute('aria-expanded', String(!panel.hidden));
    launcher.classList.toggle('ab-live', inCall);
  }

  private setNote(text: string) {
    this.ui.note.textContent = text;
    this.ui.note.hidden = !text;
  }

  private renderCaptions() {
    const box = this.ui.captions;
    box.replaceChildren();
    const items = [...this.captions.values()].slice(-6);
    for (const c of items) {
      const line = el('p', { class: `ab-line ab-${c.who}${c.final ? '' : ' ab-partial'}` });
      line.append(el('span', { class: 'ab-who' }, c.who === 'agent' ? 'Assistant' : 'You'), document.createTextNode(c.text));
      box.append(line);
    }
    box.scrollTop = box.scrollHeight;
  }

  open() {
    if (!this.ui) return; // not set up (yet): config still loading or widget not allowed here
    this.ui.panel.hidden = false;
    this.paint();
    this.ui.call.focus();
  }

  close() {
    if (!this.ui) return;
    this.ui.panel.hidden = true;
    this.paint();
    this.ui.launcher.focus();
  }

  // ------------------------------------------------------------------ call

  async start() {
    if (this.room || !this.ui) return;
    this.open();
    this.captions.clear();
    this.renderCaptions();
    this.setNote('');
    this.phase = 'connecting';
    this.agentState = '';
    this.paint();
    try {
      const r = await fetch(`${this.api}/v1/widget/session`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: this.key }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.message ?? `The voice service said HTTP ${r.status}`);

      const room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true } });
      this.room = room;
      room
        .on(RoomEvent.Reconnecting, () => { this.phase = 'reconnecting'; this.paint(); })
        .on(RoomEvent.Reconnected, () => { this.phase = 'live'; this.paint(); })
        .on(RoomEvent.Disconnected, () => this.finished())
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          if (p.kind === ParticipantKind.AGENT) void this.end(); // the assistant hung up
        })
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Audio) {
            const audio = track.attach();
            audio.style.display = 'none';
            this.host.shadowRoot!.append(audio);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach().forEach((a) => a.remove()))
        .on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
          if (topic !== 'agent') return;
          try {
            this.onAgentEvent(JSON.parse(new TextDecoder().decode(payload)) as AgentEvent);
          } catch { /* ignore */ }
        });
      // Live captions: LiveKit Agents streams what the assistant says (and what it heard).
      room.registerTextStreamHandler('lk.transcription', (reader: TextStreamReader, from) => {
        void this.readCaption(reader, from.identity === room.localParticipant.identity ? 'you' : 'agent');
      });

      await room.connect(body.url, body.token);
      await room.startAudio().catch(() => undefined);
      this.phase = 'live';
      this.paint();
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        this.phase = 'error';
        const name = (e as Error).name;
        this.setNote(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone blocked. Allow microphone access for this site (the icon in the address bar), then start the call again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Connect one and start the call again.'
            : `Microphone unavailable: ${(e as Error).message}`);
        await this.end(false);
        this.paint();
      }
    } catch (e) {
      this.phase = 'error';
      this.setNote((e as Error).message);
      await this.end(false);
      this.phase = 'error';
      this.paint();
    }
  }

  private async readCaption(reader: TextStreamReader, who: 'agent' | 'you') {
    if (!this.cfg.captions) return;
    const attrs = reader.info.attributes ?? {};
    const id = attrs['lk.segment_id'] ?? reader.info.id;
    let text = this.captions.get(id)?.text ?? '';
    for await (const chunk of reader) {
      text = who === 'agent' ? text + chunk : chunk; // agent text streams in pieces; user text is replaced
      this.captions.set(id, { who, text, final: false });
      this.renderCaptions();
    }
    this.captions.set(id, { who, text, final: attrs['lk.transcription_final'] !== 'false' });
    this.renderCaptions();
  }

  private onAgentEvent(ev: AgentEvent) {
    if (ev.type === 'state' && ev.state) {
      this.agentState = ev.state;
      this.paint();
    } else if (ev.type === 'error') {
      this.setNote(ev.message ?? 'The assistant is unavailable right now.');
    }
  }

  private async toggleMute() {
    if (!this.room) return;
    this.muted = !this.muted;
    await this.room.localParticipant.setMicrophoneEnabled(!this.muted).catch(() => undefined);
    this.paint();
  }

  async end(showEnded = true) {
    const room = this.room;
    this.room = null;
    this.muted = false;
    if (room) await room.disconnect().catch(() => undefined);
    if (showEnded) this.finished();
  }

  private finished() {
    if (this.room && this.room.state !== ConnectionState.Disconnected) return;
    this.room = null;
    if (this.phase !== 'error') this.phase = 'ended';
    this.paint();
  }
}

ready(() => {
  const key = script?.dataset.key;
  if (!key) {
    console.warn('[AudioBots] add data-key="wk_..." to the widget script tag');
    return;
  }
  if (document.getElementById('audiobots-widget')) return; // embedded twice
  const base = new URL(script!.src, location.href).origin;
  const widget = new Widget(key, base);
  (window as unknown as { AudioBots: unknown }).AudioBots = {
    open: () => widget.open(), close: () => widget.close(), start: () => widget.start(), end: () => widget.end(),
  };
  void widget.init();
});
