package br.com.drogariasminasmais.entregas;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CourierDeviceSetup",
    permissions = {
        @Permission(
            alias = "backgroundLocation",
            strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }
        )
    }
)
public class CourierDeviceSetupPlugin extends Plugin {
    @PluginMethod
    public void checkPermissionStatus(PluginCall call) {
        call.resolve(getStatus());
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            isAndroidPermissionGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        ) {
            call.resolve(getStatus());
            return;
        }
        requestPermissionForAlias(
            "backgroundLocation",
            call,
            "backgroundLocationPermissionResult"
        );
    }

    @PermissionCallback
    private void backgroundLocationPermissionResult(PluginCall call) {
        call.resolve(getStatus());
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager powerManager =
                (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (
                powerManager != null &&
                !powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName())
            ) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private JSObject getStatus() {
        JSObject status = new JSObject();
        status.put(
            "locationForeground",
            isAndroidPermissionGranted(Manifest.permission.ACCESS_FINE_LOCATION)
        );
        status.put(
            "locationBackground",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
                isAndroidPermissionGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        );
        status.put(
            "notifications",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                isAndroidPermissionGranted(Manifest.permission.POST_NOTIFICATIONS)
        );

        boolean batteryExemption = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager powerManager =
                (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            batteryExemption =
                powerManager != null &&
                powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
        }
        status.put("batteryExemption", batteryExemption);
        return status;
    }

    private boolean isAndroidPermissionGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) ==
            PackageManager.PERMISSION_GRANTED;
    }
}
