package com.therapycare.app;

import android.Manifest;
import android.content.pm.PackageManager;
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
  @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms")
})
public class SmsBridge extends Plugin {
  @PluginMethod
  public void send(PluginCall call) {
    String phone = call.getString("phone", "");
    String message = call.getString("message", "");
    if (phone.isBlank() || message.isBlank()) { call.reject("phone and message are required"); return; }
    if (getContext().checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissionForAlias("sms", call, "smsPermission"); return;
    }
    try {
      SmsManager manager = getSmsManager();
      List<String> parts = manager.divideMessage(message);
      manager.sendMultipartTextMessage(phone, null, parts, null, null);
      JSObject result = new JSObject(); result.put("queued", true); result.put("phone", phone); call.resolve(result);
    } catch (Exception e) { call.reject("SMS send failed: " + e.getMessage(), e); }
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

  private SmsManager getSmsManager() {
    SubscriptionManager sm = (SubscriptionManager) getContext().getSystemService(SubscriptionManager.class);
    if (sm != null && getContext().checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
      List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
      if (list != null && !list.isEmpty()) return SmsManager.getSmsManagerForSubscriptionId(list.get(0).getSubscriptionId());
    }
    return SmsManager.getDefault();
  }
}
