'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  ParticipantKind,
  Room,
  RoomEvent,
  type RemoteParticipant,
} from 'livekit-client';

const WORKFLOWS = [
  { id: 'router', label: 'Receptionist (router)' },
  { id: 'lead_qualification', label: 'Lead qualification' },
  { id: 'sales', label: 'Sales' },
  { id: 'support', label: 'Support' },
] as const;

type Latency = {
  end_of_turn_ms: number | null;
  stt_ms: number | null;
  llm_ttft_ms: number | null;
  tts_ttfb_ms: number | null;
  e2e_ms: number | null;
};

type Turn = {
  turn: number;
  language: string | null;
  user_text: string | null;
  agent_text: string | null;
  interrupted: boolean;
  latency: Latency;
};

type AgentEvent =
  | { type: 'agent.ready'; workflow: string; phase: number }
  | { type: 'transcript'; role: 'user'; text: string; final: boolean; language: string | null }
  | { type: 'state'; state: string }
  | { type: 'language'; language: string }
  | { type: 'error'; code: string; message: string }
  | ({ type: 'turn' } & Turn);

const LATENCY_COLS: { key: keyof Latency; label: string }[] = [
  { key: 'end_of_turn_ms', label: 'End of turn' },
  { key: 'stt_ms', label: 'STT' },
  { key: 'llm_ttft_ms', label: 'LLM TTFT' },
  { key: 'tts_ttfb_ms', label: 'TTS TTFB' },
  { key: 'e2e_ms', label: 'Voice-to-voice' },
];

function fmt(ms: number | null) {
  return ms == null ? '–' : `${ms} ms`;
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export default function DemoPage() {
  const [workflow, setWorkflow] = useState<string>('router');
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [agentJoined, setAgentJoined] = useState(false);
  const [agentState, setAgentState] = useState<string>('–');
  const [language, setLanguage] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setAgentJoined(false);
    setAgentState('–');
    setCaption('');
  }, []);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  const onAgentEvent = useCallback((ev: AgentEvent) => {
    switch (ev.type) {
      case 'transcript':
        setCaption(ev.final ? '' : ev.text);
        if (ev.language) setLanguage(ev.language);
        break;
      case 'state':
        setAgentState(ev.state);
        break;
      case 'language':
        setLanguage(ev.language);
        break;
      case 'turn':
        setTurns((t) => [...t, ev]);
        break;
      case 'error':
        setError(`Agent error (${ev.code}): ${ev.message}`);
        break;
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    setTurns([]);
    try {
      const r = await fetch('/backend/v1/livekit/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow }),
      });
      if (!r.ok) throw new Error(`Token request failed (HTTP ${r.status})`);
      const { url, token } = await r.json();

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const onParticipant = (p: RemoteParticipant) => {
        if (p.kind === ParticipantKind.AGENT) setAgentJoined(true);
      };

      room
        .on(RoomEvent.ConnectionStateChanged, setState)
        .on(RoomEvent.ParticipantConnected, onParticipant)
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          if (p.kind === ParticipantKind.AGENT) setAgentJoined(false);
        })
        .on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
          if (topic !== 'agent') return;
          try {
            onAgentEvent(JSON.parse(new TextDecoder().decode(payload)));
          } catch {
            /* ignore malformed */
          }
        })
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === 'audio') {
            const el = track.attach();
            el.style.display = 'none';
            document.body.appendChild(el);
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()));

      await room.connect(url, token);
      room.remoteParticipants.forEach(onParticipant);
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (e) {
        setError(`Microphone unavailable: ${(e as Error).message}. Allow mic access and try again.`);
      }
    } catch (e) {
      setError((e as Error).message);
      await disconnect();
    }
  }, [workflow, onAgentEvent, disconnect]);

  const connected = state === ConnectionState.Connected;
  const e2eMedian = median(turns.map((t) => t.latency.e2e_ms).filter((x): x is number => x != null));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Voice bot demo</h1>
        <p className="text-sm text-zinc-500">
          Speak in English, Hindi, Hinglish, Tamil, Telugu, Kannada or Malayalam. The bot replies in your language.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={workflow}
          onChange={(e) => setWorkflow(e.target.value)}
          disabled={connected}
          className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        >
          {WORKFLOWS.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
        {connected ? (
          <button onClick={disconnect} className="rounded-md bg-red-600 px-4 py-2 text-sm text-white">
            End call
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={state === ConnectionState.Connecting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {state === ConnectionState.Connecting ? 'Connecting…' : 'Start call'}
          </button>
        )}
        <span className="text-sm text-zinc-500" data-testid="status">
          {connected ? (agentJoined ? `Agent: ${agentState}` : 'Waiting for agent…') : state}
          {language && ` · ${language}`}
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-500">Conversation</h2>
        <div className="h-72 space-y-3 overflow-auto rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" data-testid="conversation">
          {turns.length === 0 && !caption && <p className="text-zinc-400">Start a call and say hello.</p>}
          {turns.map((t) => (
            <div key={t.turn} className="space-y-1">
              {t.user_text && <p><span className="font-medium">You:</span> {t.user_text}</p>}
              <p>
                <span className="font-medium">Bot:</span> {t.agent_text}
                {t.interrupted && <span className="ml-2 text-xs text-amber-600">(interrupted)</span>}
              </p>
            </div>
          ))}
          {caption && <p className="italic text-zinc-400">You: {caption}…</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-500">
          Latency per turn {e2eMedian != null && <span>· median voice-to-voice {e2eMedian} ms</span>}
        </h2>
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-zinc-100 text-left text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Lang</th>
                {LATENCY_COLS.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {turns.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-3 text-zinc-400">No turns yet.</td></tr>
              )}
              {turns.map((t) => (
                <tr key={t.turn}>
                  <td className="px-3 py-2">{t.turn}</td>
                  <td className="px-3 py-2">{t.language ?? '–'}</td>
                  {LATENCY_COLS.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-right ${c.key === 'e2e_ms' && (t.latency.e2e_ms ?? 0) > 800 ? 'text-amber-600' : ''}`}
                    >
                      {fmt(t.latency[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">Target: voice-to-voice ≤ 800 ms. Values above that are highlighted.</p>
      </section>
    </div>
  );
}
