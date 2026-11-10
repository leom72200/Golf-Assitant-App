package expo.modules.highspeedcamera

import android.content.Context
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HighSpeedCameraModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("HighSpeedCamera")

    /** Which high-speed modes the back camera offers to apps (sizes and fixed frame rates). */
    Function("getCapabilities") {
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      HighSpeedConfig.describe(manager)
    }

    View(HighSpeedCameraView::class) {
      Events("onCameraReady", "onCameraError")

      Prop("active") { view: HighSpeedCameraView, active: Boolean? ->
        view.active = active ?: true
      }

      Prop("fps") { view: HighSpeedCameraView, fps: Int? ->
        view.targetFps = fps ?: 240
      }

      Prop("preferredHeight") { view: HighSpeedCameraView, height: Int? ->
        view.preferredHeight = height ?: 1080
      }

      AsyncFunction("startRecording") { view: HighSpeedCameraView, promise: Promise ->
        view.startRecording(promise)
      }

      AsyncFunction("stopRecording") { view: HighSpeedCameraView, promise: Promise ->
        view.stopRecording(promise)
      }

      OnViewDestroys { view: HighSpeedCameraView ->
        view.destroy()
      }
    }
  }
}
