import { useRef, useCallback } from 'react';
import { base64ToArrayBuffer } from '@/lib/audio-utils';

export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const initPlayback = useCallback(() => {
    if (!audioContextRef.current) {
      console.info("[audio-playback]", "init.start");
      const ACtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new ACtx({ sampleRate: 24000 });
      nextPlayTimeRef.current = audioContextRef.current.currentTime;
      console.info("[audio-playback]", "init.success", {
        sampleRate: audioContextRef.current.sampleRate,
      });
      return;
    }
    console.info("[audio-playback]", "init.skip_existing_context");
  }, []);

  const playAudioChunk = useCallback((base64Audio: string) => {
    if (!audioContextRef.current) {
      console.warn("[audio-playback]", "play.skipped_no_context");
      return;
    }

    const ctx = audioContextRef.current;

    const arrayBuffer = base64ToArrayBuffer(base64Audio);
    const int16Data = new Int16Array(arrayBuffer);

    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }

    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += audioBuffer.duration;
    console.info("[audio-playback]", "play.chunk", {
      base64Length: base64Audio.length,
      samples: float32Data.length,
      duration: audioBuffer.duration,
      nextPlayTime: nextPlayTimeRef.current,
    });
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioContextRef.current) {
      console.info("[audio-playback]", "stop.start");
      audioContextRef.current.close();
      audioContextRef.current = null;
      nextPlayTimeRef.current = 0;
      console.info("[audio-playback]", "stop.complete");
      return;
    }
    console.info("[audio-playback]", "stop.skip_no_context");
  }, []);

  return { initPlayback, playAudioChunk, stopPlayback };
}
