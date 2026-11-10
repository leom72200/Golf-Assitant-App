/**
 * JS side of the 240 fps camera (Android only). In Expo Go, on iOS, or on phones without a
 * high-speed mode, `isHighSpeedCameraAvailable` is false and the view must not be rendered.
 */
import { requireNativeView, requireOptionalNativeModule } from 'expo';
import { forwardRef, type ComponentType, type Ref } from 'react';
import { Platform, type ViewProps } from 'react-native';

export interface HighSpeedMode {
  cameraId: string;
  width: number;
  height: number;
  fps: number[];
}

export interface HighSpeedCapabilities {
  supported: boolean;
  modes: HighSpeedMode[];
}

export interface CameraReadyEvent {
  width: number;
  height: number;
  fps: number;
  sensorOrientation: number;
  displayRotation: number;
}

export interface RecordingResult extends CameraReadyEvent {
  uri: string;
  durationMs: number;
}

export interface HighSpeedCameraProps extends ViewProps {
  active?: boolean;
  fps?: number;
  preferredHeight?: number;
  onCameraReady?: (e: { nativeEvent: CameraReadyEvent }) => void;
  onCameraError?: (e: { nativeEvent: { message: string } }) => void;
}

export interface HighSpeedCameraRef {
  startRecording(): Promise<{ startedAt: number }>;
  stopRecording(): Promise<RecordingResult>;
}

interface NativeModuleShape {
  getCapabilities(): HighSpeedCapabilities;
}

const NativeModule =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeModuleShape>('HighSpeedCamera') : null;

/** True when this build contains the native module (a development/production build, not Expo Go). */
export const isHighSpeedCameraAvailable = NativeModule != null;

export function getHighSpeedCapabilities(): HighSpeedCapabilities {
  if (!NativeModule) return { supported: false, modes: [] };
  try {
    return NativeModule.getCapabilities();
  } catch {
    return { supported: false, modes: [] };
  }
}

const NativeView: ComponentType<HighSpeedCameraProps & { ref?: Ref<HighSpeedCameraRef> }> | null = NativeModule
  ? requireNativeView('HighSpeedCamera')
  : null;

export const HighSpeedCameraView = forwardRef<HighSpeedCameraRef, HighSpeedCameraProps>(function HighSpeedCameraView(
  props,
  ref,
) {
  if (!NativeView) throw new Error('HighSpeedCameraView needs a development build with the native module.');
  return <NativeView {...props} ref={ref} />;
});

/**
 * Degrees to rotate a recorded frame clockwise so it's upright, given how the phone was held.
 * Recordings carry no rotation metadata, so frames come out in the sensor's orientation.
 */
export function uprightRotation(sensorOrientation: number, displayRotation: number): number {
  return (((sensorOrientation - displayRotation) % 360) + 360) % 360;
}
