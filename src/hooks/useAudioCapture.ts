import { useRef, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import { arrayBufferToBase64 } from '@/lib/audio-utils';
import {
  assertAudioCaptureSupported,
  normalizeAudioCaptureError,
} from '@/lib/audio-capture-support';

export function useAudioCapture() {
  const { setListening } = useAppStore();

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const muteNodeRef = useRef<GainNode | null>(null);
  const loggedFirstChunkRef = useRef(false);

  const startRecording = useCallback(async (onAudioData: (base64Chunk: string) => void) => {
    try {
      console.info("[audio-capture]", "start.request");
      assertAudioCaptureSupported();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      console.info("[audio-capture]", "microphone.granted", {
        audioTracks: stream.getAudioTracks().length,
      });
      streamRef.current = stream;

      const ACtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new ACtx({ sampleRate: 16000 });
      console.info("[audio-capture]", "audio_context.created", {
        sampleRate: audioContextRef.current.sampleRate,
      });

      await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
      console.info("[audio-capture]", "worklet.loaded");

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContextRef.current, 'audio-capture-processor');
      const muteNode = audioContextRef.current.createGain();
      muteNode.gain.value = 0;
      workletNodeRef.current = workletNode;
      muteNodeRef.current = muteNode;

      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const base64String = arrayBufferToBase64(event.data);
        if (!loggedFirstChunkRef.current) {
          loggedFirstChunkRef.current = true;
          console.info("[audio-capture]", "first_chunk", {
            byteLength: event.data.byteLength,
            base64Length: base64String.length,
          });
        }
        onAudioData(base64String);
      };

      source.connect(workletNode);
      workletNode.connect(muteNode);
      muteNode.connect(audioContextRef.current.destination);

      setListening(true);
      console.info("[audio-capture]", "start.success");

    } catch (error) {
      const captureError = normalizeAudioCaptureError(error);
      const log = captureError.expected ? console.warn : console.error;
      log("[audio-capture]", "start.failed", {
        code: captureError.code,
        message: captureError.message,
      });
      setListening(false);
      throw captureError;
    }
  }, [setListening]);

  const stopRecording = useCallback(() => {
    console.info("[audio-capture]", "stop.request");
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (muteNodeRef.current) {
      muteNodeRef.current.disconnect();
      muteNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    loggedFirstChunkRef.current = false;
    setListening(false);
    console.info("[audio-capture]", "stop.complete");
  }, [setListening]);

  return { startRecording, stopRecording };
}
