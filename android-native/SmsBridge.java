package com.therapycare.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.List;

@CapacitorPlugin(name = "SmsBridge", permissions = {
  @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms"),
  @Permission(strings = { Manifest.permission.CALL_PHONE }, alias = "call")
})
public class SmsBridge extends Plugin {
  @PluginMethod
  public void send(PluginCall call) { sendNow(call.getString("phone", ""), call.getString("message", ""), call); }

  @PluginMethod
  public void schedule(PluginCall call) {
    String phone = call.getString("phone", "");
    String message = call.getString("message", "");
    long at = call.getLong("atEpochMs", 0L);
    if (phone.isBlank() || message.isBlank() || at <= System.currentTimeMillis()) { call.reject("phone, message and a future atEpochMs are required"); return; }
    if (getContext().checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) { requestPermissionForAlias("sms", call, "smsPermission"); return; }
    Intent intent = new Intent(getContext(), SmsAlarmReceiver.class).setAction(SmsAlarmReceiver.ACTION_SEND_SMS)
      .putExtra(SmsAlarmReceiver.EXTRA_PHONE, phone).putExtra(SmsAlarmReceiver.EXTRA_MESSAGE, message);
    int requestCode = Math.abs((phone + at).hashCode());
    PendingIntent pi = PendingIntent.getBroadcast(getContext(), requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    AlarmManager alarm = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    JSObject result = new JSObject(); result.put("scheduled", true); result.put("atEpochMs", at); result.put("requestCode", requestCode); call.resolve(result);
  }

  @PluginMethod
  public void checkPermission(PluginCall call) {
    JSObject result = new JSObject();
    result.put("granted", getContext().checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED);
    result.put("telephony", getContext().getPackageManager().hasSystemFeature("android.hardware.telephony.messaging"));
    call.resolve(result);
  }

  @PluginMethod
  public void requestPermission(PluginCall call) { requestPermissionForAlias("sms", call, "smsPermission"); }

  @PluginMethod
  public void checkCallPermission(PluginCall call) {
    JSObject result = new JSObject();
    result.put("granted", getContext().checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED);
    result.put("telephony", getContext().getPackageManager().hasSystemFeature("android.hardware.telephony"));
    call.resolve(result);
  }

  @PluginMethod
  public void requestCallPermission(PluginCall call) { requestPermissionForAlias("call", call, "callPermission"); }

  /**
   * Places a normal cellular call from the device's active SIM. When CALL_PHONE
   * is not granted, Android's supported fallback is used: the number is handed
   * to the system dialler so the staff member confirms the call.
   */
  @PluginMethod
  public void call(PluginCall pluginCall) {
    String phone = pluginCall.getString("phone", "");
    if (phone == null || phone.isBlank()) { pluginCall.reject("phone is required"); return; }
    boolean granted = getContext().checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED;
    try {
      Intent intent = new Intent(granted ? Intent.ACTION_CALL : Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(phone)));
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      JSObject result = new JSObject();
      result.put("placed", true);
      result.put("mode", granted ? "call" : "dialer");
      pluginCall.resolve(result);
    } catch (Exception e) { pluginCall.reject("Call failed: " + e.getMessage(), e); }
  }

  private void sendNow(String phone, String message, PluginCall call) {
    if (phone.isBlank() || message.isBlank()) { call.reject("phone and message are required"); return; }
    if (getContext().checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) { requestPermissionForAlias("sms", call, "smsPermission"); return; }
    try {
      SmsManager manager = getSmsManager();
      List<String> parts = manager.divideMessage(message);
      manager.sendMultipartTextMessage(phone, null, parts, null, null);
      JSObject result = new JSObject(); result.put("queued", true); result.put("phone", phone); call.resolve(result);
    } catch (Exception e) { call.reject("SMS send failed: " + e.getMessage(), e); }
  }

  private SmsManager getSmsManager() {
    SubscriptionManager sm = (SubscriptionManager) getContext().getSystemService(SubscriptionManager.class);
    if (sm != null && getContext().checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
      List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
      if (list != null && !list.isEmpty()) return SmsManager.getSmsManagerForSubscriptionId(list.get(0).getSubscriptionId());
    }
    return SmsManager.getDefault();
  }
}
