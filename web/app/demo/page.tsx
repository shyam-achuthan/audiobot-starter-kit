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

type LogLine = { t: string; msg: string };

export default function DemoPage() {
  const [workflow, setWorkflow] = useState<string>('router');
  const [state, setState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [agentJoined, setAgentJoined] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const roomRef = useRef<Room | null>(null);

  const push = useCallback((msg: string) => {
    setLog((l) => [...l.slice(-49), { t: new Date().toLocaleTimeString(), msg }]);
  }, []);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setAgentJoined(false);
  }, []);

  useEffect(() => () => void roomRef.current?.disconnect(), []);

  const connect = useCallback(async () => {
    try {
      push(`Requesting token for workflow "${workflow}"…`);
      const r = await fetch('/backend/v1/livekit/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workflow }),
      });
      if (!r.ok) throw new Error(`token request failed: HTTP ${r.status}`);
      const { url, token, room: roomName } = await r.json();

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const onParticipant = (p: RemoteParticipant) => {
        if (p.kind === ParticipantKind.AGENT) {
          setAgentJoined(true);
          push(`Agent joined: ${p.identity}`);
        } else {
          push(`Participant joined: ${p.identity}`);
        }
      };

      room
        .on(RoomEvent.ConnectionStateChanged, setState)
        .on(RoomEvent.ParticipantConnected, onParticipant)
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          if (p.kind === ParticipantKind.AGENT) setAgentJoined(false);
          push(`Left: ${p.identity}`);
        })
        .on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
          push(`Data [${topic ?? '-'}]: ${new TextDecoder().decode(payload)}`);
        })
        .on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === 'audio') {
            const el = track.attach();
            el.style.display = 'none';
            document.body.appendChild(el);
            push('Subscribed to agent audio');
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((el) => el.remove()))
        .on(RoomEvent.Disconnected, () => push('Disconnected'));

      await room.connect(url, token);
      push(`Connected to room ${roomName}`);
      room.remoteParticipants.forEach(onParticipant);
      await room.localParticipant.setMicrophoneEnabled(true);
      push('Microphone on');
    } catch (e) {
      push(`Error: ${(e as Error).message}`);
      await disconnect();
    }
  }, [workflow, push, disconnect]);

  const connected = state === ConnectionState.Connected;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Voice bot demo</h1>
        <p className="text-sm text-zinc-500">
          Phase 0: checks the web → LiveKit → agent path. Voice conversation arrives in Phase 1.
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
          {state}
          {connected && (agentJoined ? ' · agent present' : ' · waiting for agent…')}
        </span>
      </div>

      <pre className="h-72 overflow-auto rounded-md border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900" data-testid="log">
        {log.map((l) => `${l.t}  ${l.msg}`).join('\n') || 'Log is empty'}
      </pre>
    </div>
  );
}
