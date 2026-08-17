package com.therapycare.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.telephony.SmsManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(name = "SmsBridge", permissions = {
  @Permission(strings = { Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_PHONE_STATE }, alias = "sms"),
  @Permission(strings = { Manifest.permission.CALL_PHONE }, alias = "call")
})
public class SmsBridge extends Plugin {
  private static final String PREFS = "therapycare_sms_bridge";
  private static final String PENDING_INBOUND = "pending_inbound_sms";

  @PluginMethod
  public void send(PluginCall call) { sendNow(call.getString("phone", ""), call.getString("message", ""), call.getLong("subscriptionId", -1L), call); }

  @PluginMethod
  public void schedule(PluginCall call) {
    String phone = call.getString("phone", "");
    String message = call.getString("message", "");
    long at = call.getLong("atEpochMs", 0L);
    long subscriptionId = call.getLong("subscriptionId", -1L);
    if (phone.isBlank() || message.isBlank() || at <= System.currentTimeMillis()) { call.reject("phone, message and a future atEpochMs are required"); return; }
    if (getContext().checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) { requestPermissionForAlias("sms", call, "smsPermission"); return; }
    Intent intent = new Intent(getContext(), SmsAlarmReceiver.class).setAction(SmsAlarmReceiver.ACTION_SEND_SMS)
      .putExtra(SmsAlarmReceiver.EXTRA_PHONE, phone).putExtra(SmsAlarmReceiver.EXTRA_MESSAGE, message).putExtra("subscriptionId", subscriptionId);
    int requestCode = Math.abs((phone + at + subscriptionId).hashCode());
    PendingIntent pi = PendingIntent.getBroadcast(getContext(), requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    AlarmManager alarm = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
    alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    JSObject result = new JSObject(); result.put("scheduled", true); result.put("atEpochMs", at); result.put("requestCode", requestCode); call.resolve(result);
  }

  @PluginMethod
  public void checkPermission(PluginCall call) {
    JSObject result = new JSObject();
    result.put("granted", getContext().checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED);
    result.put("inboundGranted", getContext().checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED);
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

  @PluginMethod
  public void getActiveSubscriptions(PluginCall call) {
    if (getContext().checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
      call.resolve(new JSArray());
      return;
    }
    try {
      SubscriptionManager sm = (SubscriptionManager) getContext().getSystemService(SubscriptionManager.class);
      List<SubscriptionInfo> list = sm == null ? null : sm.getActiveSubscriptionInfoList();
      JSArray result = new JSArray();
      if (list != null) {
        for (SubscriptionInfo info : list) {
          JSObject row = new JSObject();
          row.put("subscriptionId", info.getSubscriptionId());
          row.put("slotIndex", info.getSimSlotIndex());
          row.put("displayName", info.getDisplayName() == null ? "SIM" : info.getDisplayName().toString());
          row.put("carrierName", info.getCarrierName() == null ? "" : info.getCarrierName().toString());
          result.put(row);
        }
      }
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Unable to read active SIM subscriptions", e);
    }
  }

  /** Places a normal cellular call. The system's configured/default SIM is used for the call. */
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

  @PluginMethod
  public void getPendingInboundSms(PluginCall call) {
    if (getContext().checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) { call.resolve(new JSArray()); return; }
    try {
      String raw = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PENDING_INBOUND, "[]");
      JSONArray stored = new JSONArray(raw);
      JSArray result = new JSArray();
      for (int i = 0; i < stored.length(); i++) {
        JSONObject item = stored.getJSONObject(i);
        JSObject row = new JSObject();
        row.put("id", item.optString("id")); row.put("senderPhone", item.optString("senderPhone")); row.put("message", item.optString("message")); row.put("receivedAt", item.optLong("receivedAt", System.currentTimeMillis()));
        result.put(row);
      }
      call.resolve(result);
    } catch (Exception e) { call.reject("Unable to read pending inbound SMS", e); }
  }

  @PluginMethod
  public void acknowledgeInboundSms(PluginCall call) {
    String id = call.getString("id", "");
    if (id.isBlank()) { call.reject("id is required"); return; }
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      JSONArray stored = new JSONArray(prefs.getString(PENDING_INBOUND, "[]"));
      JSONArray remaining = new JSONArray();
      for (int i = 0; i < stored.length(); i++) { JSONObject item = stored.getJSONObject(i); if (!id.equals(item.optString("id"))) remaining.put(item); }
      prefs.edit().putString(PENDING_INBOUND, remaining.toString()).apply(); call.resolve();
    } catch (Exception e) { call.reject("Unable to acknowledge inbound SMS", e); }
  }

  public static void storeInboundSms(Context context, String senderPhone, String message, long receivedAt) {
    if (senderPhone == null || senderPhone.isBlank() || message == null || message.isBlank()) return;
    try {
      SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
      JSONArray stored = new JSONArray(prefs.getString(PENDING_INBOUND, "[]"));
      JSONObject item = new JSONObject(); item.put("id", UUID.randomUUID().toString()); item.put("senderPhone", senderPhone); item.put("message", message); item.put("receivedAt", receivedAt);
      stored.put(item); prefs.edit().putString(PENDING_INBOUND, stored.toString()).apply();
    } catch (Exception ignored) { }
  }

  private void sendNow(String phone, String message, long subscriptionId, PluginCall call) {
    if (phone.isBlank() || message.isBlank()) { call.reject("phone and message are required"); return; }
    if (getContext().checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) { requestPermissionForAlias("sms", call, "smsPermission"); return; }
    try {
      SmsManager manager = getSmsManager(subscriptionId);
      List<String> parts = manager.divideMessage(message);
      manager.sendMultipartTextMessage(phone, null, parts, null, null);
      JSObject result = new JSObject(); result.put("queued", true); result.put("phone", phone); result.put("subscriptionId", subscriptionId); call.resolve(result);
    } catch (Exception e) { call.reject("SMS send failed: " + e.getMessage(), e); }
  }

  private SmsManager getSmsManager(long selectedSubscriptionId) {
    SubscriptionManager sm = (SubscriptionManager) getContext().getSystemService(SubscriptionManager.class);
    if (selectedSubscriptionId > 0 && getContext().checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
      return SmsManager.getSmsManagerForSubscriptionId((int) selectedSubscriptionId);
    }
    if (sm != null && getContext().checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
      List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
      if (list != null && !list.isEmpty()) return SmsManager.getSmsManagerForSubscriptionId(list.get(0).getSubscriptionId());
    }
    return SmsManager.getDefault();
  }
}
