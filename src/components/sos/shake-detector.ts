"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shake-to-SOS thresholds.
 *
 * Both directions of error are expensive here, so the numbers are chosen
 * against what a body actually produces rather than what a demo video shows:
 *
 *   - Walking is roughly 0.3-0.8 m/s^2 of linear motion. A detector that fires
 *     on walking fires every time the user crosses a road, so the peak
 *     threshold sits well clear of it.
 *   - One pothole in a matatu spikes 1.5-3 g for a single 20-40 ms sample. A
 *     peak-only detector would page a family from a taxi, so a spike is never
 *     enough on its own: the motion has to be *sustained* for
 *     `SHAKE_SUSTAIN_MS` with no lull longer than `SHAKE_MAX_GAP_MS`. A pothole
 *     produces one sample and then nothing, so it can never fill that window.
 *   - Deliberate shaking re-crosses the threshold several times a second, which
 *     is the only pattern that fills the window.
 *
 * The peak is measured as deviation from a low-pass gravity estimate rather
 * than raw acceleration, so the detector is indifferent to how the phone is
 * held: upright, flat in a pocket, or face down.
 */
const SHAKE_PEAK_MPS2 = 12;
const SHAKE_SUSTAIN_MS = 1200;
const SHAKE_MAX_GAP_MS = 400;
const SHAKE_COOLDOWN_MS = 30_000;

/** Weight kept from the previous gravity sample. Higher means slower tracking. */
const GRAVITY_SMOOTHING = 0.8;

/**
 * iOS 13+ gates motion sensors behind a static `requestPermission` that must be
 * called from inside a user gesture. No standard TypeScript DOM lib declares
 * it, so the shape is declared once here instead of being cast at the call
 * site, and is probed rather than assumed: desktop browsers and most Androids
 * never expose it, and never need it.
 */
type MotionPermissionCapable = {
  requestPermission: () => Promise<PermissionState>;
};

const isMotionPermissionCapable = (value: object): value is MotionPermissionCapable =>
  "requestPermission" in value && typeof Reflect.get(value, "requestPermission") === "function";

const requestMotionAccess = async (): Promise<PermissionState> => {
  if (typeof DeviceMotionEvent === "undefined") {
    return "denied";
  }
  return isMotionPermissionCapable(DeviceMotionEvent)
    ? DeviceMotionEvent.requestPermission()
    : "granted";
};

type GravityEstimate = {
  x: number;
  y: number;
  z: number;
  /** False until the first sample, so the filter starts from the device's own reading. */
  primed: boolean;
};

type ShakeWindow = {
  /** When the current run of strong motion began. 0 when no run is in progress. */
  startedAt: number;
  /** When the most recent strong sample landed, used to police the maximum gap. */
  lastStrongAt: number;
  lastFiredAt: number;
};

export type ShakeDetection = {
  /** False on devices with no motion sensor. The button path stays primary. */
  supported: boolean;
  /** True only while motion events are actually being delivered. */
  listening: boolean;
  /**
   * Ask for sensor access. Must be called from a user gesture — a tap on
   * "Turn on shake-to-SOS" — because that is the only moment iOS will answer.
   * Resolves false when the device cannot do it or the user said no.
   */
  enable: () => Promise<boolean>;
  disable: () => void;
};

/**
 * Silent shake as an SOS trigger.
 *
 * The hook never enables itself. An app that reacts to being jostled without
 * consent is a privacy problem before it is a safety feature: motion is a
 * continuous sensor, and someone who has not opted in should never have to
 * wonder whether moving their phone can page their family. The caller owns the
 * `enabled` flag, the user grants access from a tap, and `disable` detaches the
 * listener immediately.
 *
 * @param onShake Invoked when a sustained shake is recognised. Callers are
 *   responsible for dispatching with `trigger: "shake"`.
 * @param enabled Whether the user has switched shake-to-SOS on.
 * @returns Support and permission state plus the controls the settings screen
 *   needs in order to offer the feature without over-promising it.
 */
export const useShakeDetection = (onShake: () => void, enabled: boolean): ShakeDetection => {
  const [supported, setSupported] = useState(false);
  const [consented, setConsented] = useState(false);
  const [listening, setListening] = useState(false);

  const onShakeRef = useRef(onShake);
  const gravityRef = useRef<GravityEstimate>({ x: 0, y: 0, z: 0, primed: false });
  const windowRef = useRef<ShakeWindow>({ startedAt: 0, lastStrongAt: 0, lastFiredAt: 0 });

  useEffect(() => {
    onShakeRef.current = onShake;
  }, [onShake]);

  useEffect(() => {
    // `ondevicemotion` in window is the only reliable support test: the
    // constructor exists on plenty of desktops that will never fire the event.
    setSupported(typeof window !== "undefined" && "ondevicemotion" in window);
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("ondevicemotion" in window)) {
      return false;
    }

    let state: PermissionState;
    try {
      state = await requestMotionAccess();
    } catch (cause) {
      console.error("shake-to-sos permission request failed", { cause });
      return false;
    }

    if (state !== "granted") {
      console.info("shake-to-sos stayed off: motion access was not granted", { state });
      setConsented(false);
      return false;
    }

    setConsented(true);
    return true;
  }, []);

  const disable = useCallback((): void => {
    setConsented(false);
  }, []);

  useEffect(() => {
    if (!supported || !enabled || !consented) {
      return;
    }

    gravityRef.current = { x: 0, y: 0, z: 0, primed: false };
    windowRef.current = { startedAt: 0, lastStrongAt: 0, lastFiredAt: 0 };

    const handleMotion = (event: DeviceMotionEvent): void => {
      const acceleration = event.acceleration;
      if (acceleration === null) {
        return;
      }

      const x = acceleration.x ?? 0;
      const y = acceleration.y ?? 0;
      const z = acceleration.z ?? 0;

      const gravity = gravityRef.current;
      if (gravity.primed) {
        const correction = 1 - GRAVITY_SMOOTHING;
        gravity.x += (x - gravity.x) * correction;
        gravity.y += (y - gravity.y) * correction;
        gravity.z += (z - gravity.z) * correction;
      } else {
        gravity.x = x;
        gravity.y = y;
        gravity.z = z;
        gravity.primed = true;
      }

      const magnitude = Math.hypot(x - gravity.x, y - gravity.y, z - gravity.z);
      if (magnitude < SHAKE_PEAK_MPS2) {
        return;
      }

      const now = performance.now();
      const shake = windowRef.current;
      const previousStrongAt = shake.lastStrongAt;
      shake.lastStrongAt = now;
      if (shake.startedAt === 0) {
        shake.startedAt = now;
      }

      const gap = previousStrongAt === 0 ? 0 : now - previousStrongAt;
      if (gap > SHAKE_MAX_GAP_MS) {
        // A lull this long means the previous spike was an impact, not a shake.
        // Restarting the window stops two separate jolts from adding up.
        shake.startedAt = now;
        return;
      }

      if (now - shake.startedAt < SHAKE_SUSTAIN_MS) {
        return;
      }

      if (now - shake.lastFiredAt < SHAKE_COOLDOWN_MS) {
        return;
      }

      shake.startedAt = 0;
      shake.lastStrongAt = 0;
      shake.lastFiredAt = now;
      onShakeRef.current();
    };

    window.addEventListener("devicemotion", handleMotion);
    setListening(true);

    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      setListening(false);
    };
  }, [supported, enabled, consented]);

  return { supported, listening, enable, disable };
};
