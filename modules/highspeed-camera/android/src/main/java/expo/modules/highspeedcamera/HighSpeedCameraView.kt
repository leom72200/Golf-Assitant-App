package expo.modules.highspeedcamera

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Matrix
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraConstrainedHighSpeedCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.MediaCodec
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import android.view.TextureView
import android.view.WindowManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import kotlin.math.min

private const val TAG = "HighSpeedCamera"

/**
 * Camera preview + 240 fps recording using a Camera2 constrained high-speed session.
 *
 * Recording uses a persistent input surface (MediaCodec.createPersistentInputSurface), so the
 * capture session stays up between clips: JS can start/stop short clips back-to-back while
 * the preview keeps running. This follows Google's Camera2SlowMotion sample.
 */
@SuppressLint("ViewConstructor")
class HighSpeedCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext),
  TextureView.SurfaceTextureListener {

  override val shouldUseAndroidLayout = true

  private val onCameraReady by EventDispatcher<Map<String, Any?>>()
  private val onCameraError by EventDispatcher<Map<String, Any?>>()

  // Props
  var active: Boolean = true
    set(value) {
      if (field != value) {
        field = value
        if (value) openCameraIfReady() else closeCamera()
      }
    }
  var targetFps: Int = 240
  var preferredHeight: Int = 1080

  private val textureView = TextureView(context)
  private var cameraThread: HandlerThread? = null
  private var cameraHandler: Handler? = null

  private var config: HighSpeedConfig? = null
  private var device: CameraDevice? = null
  private var session: CameraConstrainedHighSpeedCaptureSession? = null
  private var previewSurface: Surface? = null
  private var recorderSurface: Surface? = null
  private var recorder: MediaRecorder? = null
  private var recordingFile: File? = null
  private var recordingStartedAt = 0L
  private var opening = false

  init {
    addView(textureView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    textureView.surfaceTextureListener = this
  }

  // ---- Lifecycle ----------------------------------------------------------------------------

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    openCameraIfReady()
  }

  override fun onDetachedFromWindow() {
    closeCamera()
    super.onDetachedFromWindow()
  }

  override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
    openCameraIfReady()
  }

  override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
    applyPreviewTransform()
  }

  override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
    closeCamera()
    return true
  }

  override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    if (changed) applyPreviewTransform()
  }

  fun destroy() {
    closeCamera()
  }

  // ---- Camera setup -------------------------------------------------------------------------

  private fun startThread(): Handler {
    cameraHandler?.let { return it }
    val thread = HandlerThread("HighSpeedCamera").also { it.start() }
    cameraThread = thread
    return Handler(thread.looper).also { cameraHandler = it }
  }

  private fun stopThread() {
    cameraThread?.quitSafely()
    cameraThread = null
    cameraHandler = null
  }

  @SuppressLint("MissingPermission") // JS asks for the camera permission before mounting the view.
  private fun openCameraIfReady() {
    if (!active || opening || device != null || !isAttachedToWindow || !textureView.isAvailable) return
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val chosen = HighSpeedConfig.choose(manager, targetFps, preferredHeight)
    if (chosen == null) {
      emitError("This phone doesn't offer a high-speed (120/240 fps) video mode to apps.")
      return
    }
    config = chosen
    opening = true
    val handler = startThread()
    try {
      manager.openCamera(chosen.cameraId, object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
          opening = false
          device = camera
          createSession(camera, chosen)
        }

        override fun onDisconnected(camera: CameraDevice) {
          opening = false
          camera.close()
          device = null
        }

        override fun onError(camera: CameraDevice, error: Int) {
          opening = false
          camera.close()
          device = null
          emitError("Camera error $error")
        }
      }, handler)
    } catch (e: Exception) {
      opening = false
      emitError("Couldn't open the camera: ${e.message}")
    }
  }

  @Suppress("DEPRECATION") // createConstrainedHighSpeedCaptureSession works on every API level we support.
  private fun createSession(camera: CameraDevice, cfg: HighSpeedConfig) {
    val texture = textureView.surfaceTexture ?: return
    // High-speed sessions need the preview and recording surfaces at the same size.
    texture.setDefaultBufferSize(cfg.size.width, cfg.size.height)
    val preview = Surface(texture)
    previewSurface = preview

    // A persistent surface lets each clip get a fresh MediaRecorder without rebuilding the
    // session. It must be configured once by a recorder before the session can use it.
    val persistent = MediaCodec.createPersistentInputSurface()
    try {
      newRecorder(persistent, File(context.cacheDir, "highspeed-warmup.mp4"), cfg).apply {
        prepare()
        release()
      }
    } catch (e: Exception) {
      emitError("Couldn't set up high-speed recording: ${e.message}")
      return
    }
    recorderSurface = persistent

    camera.createConstrainedHighSpeedCaptureSession(
      listOf(preview, persistent),
      object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
          val hs = s as CameraConstrainedHighSpeedCaptureSession
          session = hs
          try {
            hs.setRepeatingBurst(requestList(hs, recording = false), null, cameraHandler)
          } catch (e: Exception) {
            emitError("Couldn't start the preview: ${e.message}")
            return
          }
          post {
            applyPreviewTransform()
            onCameraReady(
              mapOf(
                "width" to cfg.size.width,
                "height" to cfg.size.height,
                "fps" to cfg.fps,
                "sensorOrientation" to cfg.sensorOrientation,
                "displayRotation" to displayRotationDegrees(),
              )
            )
          }
        }

        override fun onConfigureFailed(s: CameraCaptureSession) {
          emitError("The camera refused the high-speed configuration.")
        }
      },
      cameraHandler
    )
  }

  private fun requestList(s: CameraConstrainedHighSpeedCaptureSession, recording: Boolean): List<CaptureRequest> {
    val cfg = config ?: throw IllegalStateException("Camera not configured")
    val builder = s.device.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
      previewSurface?.let { addTarget(it) }
      if (recording) recorderSurface?.let { addTarget(it) }
      set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(cfg.fps, cfg.fps))
    }
    return s.createHighSpeedRequestList(builder.build())
  }

  private fun newRecorder(surface: Surface, file: File, cfg: HighSpeedConfig): MediaRecorder {
    val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else {
      @Suppress("DEPRECATION") MediaRecorder()
    }
    return r.apply {
      setVideoSource(MediaRecorder.VideoSource.SURFACE)
      setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      setOutputFile(file.absolutePath)
      // ~0.1 bit per pixel per frame keeps fast motion sharp; capped for the encoder.
      val bitRate = min(80_000_000L, cfg.size.width.toLong() * cfg.size.height * cfg.fps / 10).toInt()
      setVideoEncodingBitRate(bitRate)
      setVideoFrameRate(cfg.fps)
      setVideoSize(cfg.size.width, cfg.size.height)
      setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      setInputSurface(surface)
    }
  }

  private fun closeCamera() {
    try {
      recorder?.apply {
        try {
          stop()
        } catch (ignored: Exception) {
        }
        release()
      }
    } catch (ignored: Exception) {
    }
    recorder = null
    recordingFile?.delete()
    recordingFile = null
    try {
      session?.close()
    } catch (ignored: Exception) {
    }
    session = null
    device?.close()
    device = null
    previewSurface?.release()
    previewSurface = null
    recorderSurface?.release()
    recorderSurface = null
    opening = false
    stopThread()
  }

  // ---- Recording ----------------------------------------------------------------------------

  fun startRecording(promise: Promise) {
    val handler = cameraHandler
    if (handler == null) {
      promise.reject("E_NOT_READY", "Camera isn't running", null)
      return
    }
    handler.post {
      val s = session
      val cfg = config
      val surface = recorderSurface
      if (s == null || cfg == null || surface == null) {
        promise.reject("E_NOT_READY", "Camera isn't ready yet", null)
        return@post
      }
      if (recorder != null) {
        promise.reject("E_BUSY", "Already recording", null)
        return@post
      }
      try {
        val dir = File(context.cacheDir, "highspeed").apply { mkdirs() }
        val file = File(dir, "clip-${System.currentTimeMillis()}.mp4")
        val r = newRecorder(surface, file, cfg)
        r.prepare()
        s.setRepeatingBurst(requestList(s, recording = true), null, handler)
        r.start()
        recorder = r
        recordingFile = file
        recordingStartedAt = SystemClock.elapsedRealtime()
        promise.resolve(mapOf("startedAt" to System.currentTimeMillis()))
      } catch (e: Exception) {
        Log.w(TAG, "startRecording failed", e)
        recorder?.release()
        recorder = null
        try {
          s.setRepeatingBurst(requestList(s, recording = false), null, handler)
        } catch (ignored: Exception) {
        }
        promise.reject("E_RECORD", "Couldn't start recording: ${e.message}", e)
      }
    }
  }

  fun stopRecording(promise: Promise) {
    val handler = cameraHandler
    if (handler == null) {
      promise.reject("E_NOT_READY", "Camera isn't running", null)
      return
    }
    handler.post {
      val r = recorder
      val file = recordingFile
      val s = session
      val cfg = config
      if (r == null || file == null || cfg == null) {
        promise.reject("E_NOT_RECORDING", "Not recording", null)
        return@post
      }
      val durationMs = SystemClock.elapsedRealtime() - recordingStartedAt
      // Stop feeding the recorder before stopping it.
      if (s != null) {
        try {
          s.setRepeatingBurst(requestList(s, recording = false), null, handler)
        } catch (ignored: Exception) {
        }
      }
      var ok = true
      try {
        r.stop()
      } catch (e: RuntimeException) {
        // stop() throws if no frames arrived (e.g. stopped immediately after starting).
        ok = false
      }
      r.release()
      recorder = null
      recordingFile = null
      if (!ok) {
        file.delete()
        promise.reject("E_EMPTY", "Recording was too short", null)
        return@post
      }
      promise.resolve(
        mapOf(
          "uri" to "file://${file.absolutePath}",
          "durationMs" to durationMs.toDouble(),
          "width" to cfg.size.width,
          "height" to cfg.size.height,
          "fps" to cfg.fps,
          "sensorOrientation" to cfg.sensorOrientation,
          "displayRotation" to displayRotationDegrees(),
        )
      )
    }
  }

  // ---- Helpers ------------------------------------------------------------------------------

  private fun emitError(message: String) {
    Log.w(TAG, message)
    post { onCameraError(mapOf("message" to message)) }
  }

  @Suppress("DEPRECATION")
  private fun displayRotationDegrees(): Int {
    // The view's own display: React Native's context isn't always a visual context.
    val rotation = display?.rotation
      ?: (context.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
    return when (rotation) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
  }

  /**
   * Rotate/scale the preview so it appears upright and uncropped ("contain"), as in Google's
   * Camera2Basic sample. The buffer is in sensor orientation (landscape).
   */
  private fun applyPreviewTransform() {
    val cfg = config ?: return
    val viewW = textureView.width.toFloat()
    val viewH = textureView.height.toFloat()
    if (viewW == 0f || viewH == 0f) return
    val rotation = displayRotationDegrees()
    val matrix = Matrix()
    val viewRect = RectF(0f, 0f, viewW, viewH)
    val cx = viewRect.centerX()
    val cy = viewRect.centerY()
    val bufW = cfg.size.width.toFloat()
    val bufH = cfg.size.height.toFloat()
    if (rotation == 90 || rotation == 270) {
      val bufferRect = RectF(0f, 0f, bufH, bufW)
      bufferRect.offset(cx - bufferRect.centerX(), cy - bufferRect.centerY())
      matrix.setRectToRect(viewRect, bufferRect, Matrix.ScaleToFit.FILL)
      val scale = min(viewH / bufH, viewW / bufW)
      matrix.postScale(scale, scale, cx, cy)
      matrix.postRotate((rotation - 180).toFloat(), cx, cy)
    } else {
      // Portrait: the system already rotates the buffer; just fit its aspect ratio.
      val contentW = bufH
      val contentH = bufW
      val scale = min(viewW / contentW, viewH / contentH)
      matrix.setScale(contentW * scale / viewW, contentH * scale / viewH, cx, cy)
      if (rotation == 180) matrix.postRotate(180f, cx, cy)
    }
    textureView.setTransform(matrix)
  }
}

/** The camera, size and frame rate chosen for high-speed capture. */
data class HighSpeedConfig(
  val cameraId: String,
  val size: Size,
  val fps: Int,
  val sensorOrientation: Int,
) {
  companion object {
    /**
     * Pick the back camera's best high-speed mode: the requested fps (or the highest fixed
     * rate available), at the size closest to `preferredHeight`.
     */
    fun choose(manager: CameraManager, targetFps: Int, preferredHeight: Int): HighSpeedConfig? {
      for (id in manager.cameraIdList) {
        val chars = manager.getCameraCharacteristics(id)
        if (chars.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue
        val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: continue
        if (!caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO)) continue
        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: continue
        val options = map.highSpeedVideoSizes.flatMap { size ->
          // Recording requires a fixed range like [240, 240].
          map.getHighSpeedVideoFpsRangesFor(size)
            .filter { it.lower == it.upper && it.upper >= 120 }
            .map { size to it.upper }
        }
        if (options.isEmpty()) continue
        val bestFps = options.map { it.second }.filter { it <= targetFps }.maxOrNull()
          ?: options.minOf { it.second }
        val (size, fps) = options
          .filter { it.second == bestFps }
          .minByOrNull { kotlin.math.abs(it.first.height - preferredHeight) }
          ?: continue
        val orientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
        return HighSpeedConfig(id, size, fps, orientation)
      }
      return null
    }

    fun describe(manager: CameraManager): Map<String, Any?> {
      val modes = mutableListOf<Map<String, Any?>>()
      for (id in manager.cameraIdList) {
        val chars = manager.getCameraCharacteristics(id)
        if (chars.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue
        val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: continue
        if (!caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO)) continue
        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: continue
        for (size in map.highSpeedVideoSizes) {
          val fps = map.getHighSpeedVideoFpsRangesFor(size).filter { it.lower == it.upper }.map { it.upper }.distinct()
          modes.add(mapOf("cameraId" to id, "width" to size.width, "height" to size.height, "fps" to fps))
        }
      }
      return mapOf("supported" to modes.isNotEmpty(), "modes" to modes)
    }
  }
}
