export type AudioCaptureFailureCode =
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED_BROWSER"
  | "PERMISSION_DENIED"
  | "NO_MICROPHONE"
  | "MICROPHONE_BUSY"
  | "UNSUPPORTED_CONSTRAINT"
  | "UNKNOWN";

interface AudioCaptureEnvironment {
  isSecureContext: boolean;
  getUserMedia?: MediaDevices["getUserMedia"];
}

export class AudioCaptureStartError extends Error {
  readonly code: AudioCaptureFailureCode;
  readonly userMessage: string;
  readonly expected: boolean;

  constructor({
    code,
    cause,
    expected = true,
    message,
    userMessage,
  }: {
    code: AudioCaptureFailureCode;
    cause?: unknown;
    expected?: boolean;
    message: string;
    userMessage: string;
  }) {
    super(message, { cause });
    this.name = "AudioCaptureStartError";
    this.code = code;
    this.userMessage = userMessage;
    this.expected = expected;
  }
}

export function assertAudioCaptureSupported() {
  const supportError = getAudioCaptureSupportError();
  if (supportError) throw supportError;
}

export function getAudioCaptureSupportError(
  environment: AudioCaptureEnvironment = getBrowserAudioEnvironment(),
): AudioCaptureStartError | null {
  if (!environment.isSecureContext) {
    return new AudioCaptureStartError({
      code: "INSECURE_CONTEXT",
      message: "Microphone capture requires a secure browser context.",
      userMessage:
        "Voice needs a secure page on Android. Open the HTTPS local dev URL, or use localhost on this computer.",
    });
  }

  if (typeof environment.getUserMedia !== "function") {
    return new AudioCaptureStartError({
      code: "UNSUPPORTED_BROWSER",
      message: "Microphone capture is not available in this browser context.",
      userMessage:
        "This browser cannot access the microphone here. Use Chrome over HTTPS, then try again.",
    });
  }

  return null;
}

export function normalizeAudioCaptureError(error: unknown): AudioCaptureStartError {
  if (isAudioCaptureStartError(error)) return error;

  const name = getErrorName(error);
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return new AudioCaptureStartError({
      code: "PERMISSION_DENIED",
      cause: error,
      message: "Microphone permission was denied.",
      userMessage:
        "Microphone permission was blocked. Allow microphone access in the browser and try again.",
    });
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new AudioCaptureStartError({
      code: "NO_MICROPHONE",
      cause: error,
      message: "No microphone input device was found.",
      userMessage: "No microphone was found on this device.",
    });
  }

  if (
    name === "NotReadableError" ||
    name === "AbortError" ||
    name === "TrackStartError"
  ) {
    return new AudioCaptureStartError({
      code: "MICROPHONE_BUSY",
      cause: error,
      message: "The microphone is busy or unavailable.",
      userMessage:
        "The microphone is busy or unavailable. Close other apps using it and try again.",
    });
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return new AudioCaptureStartError({
      code: "UNSUPPORTED_CONSTRAINT",
      cause: error,
      message: "The microphone cannot satisfy the requested capture settings.",
      userMessage:
        "This microphone does not support the requested capture settings. Try another microphone or browser.",
    });
  }

  if (name === "SecurityError") {
    return new AudioCaptureStartError({
      code: "INSECURE_CONTEXT",
      cause: error,
      message: "Microphone capture was blocked by browser security.",
      userMessage:
        "Voice needs a secure page on Android. Open the HTTPS local dev URL, or use localhost on this computer.",
    });
  }

  return new AudioCaptureStartError({
    code: "UNKNOWN",
    cause: error,
    expected: false,
    message: error instanceof Error ? error.message : "Microphone could not start.",
    userMessage: "Microphone could not start. Check browser permission and try again.",
  });
}

export function isAudioCaptureStartError(
  error: unknown,
): error is AudioCaptureStartError {
  return error instanceof AudioCaptureStartError;
}

function getBrowserAudioEnvironment(): AudioCaptureEnvironment {
  return {
    isSecureContext:
      typeof window !== "undefined" ? window.isSecureContext === true : false,
    getUserMedia:
      typeof navigator !== "undefined"
        ? navigator.mediaDevices?.getUserMedia
        : undefined,
  };
}

function getErrorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return null;
  }

  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}
