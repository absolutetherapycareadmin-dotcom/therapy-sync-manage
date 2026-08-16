package com.therapycare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.SmsManager;
import java.util.ArrayList;

public class SmsAlarmReceiver extends BroadcastReceiver {
  public static final String ACTION_SEND_SMS = "com.therapycare.app.SEND_SMS";
  public static final String EXTRA_PHONE = "phone";
  public static final String EXTRA_MESSAGE = "message";

  @Override public void onReceive(Context context, Intent intent) {
    if (!ACTION_SEND_SMS.equals(intent.getAction())) return;
    String phone = intent.getStringExtra(EXTRA_PHONE);
    String message = intent.getStringExtra(EXTRA_MESSAGE);
    if (phone == null || phone.isBlank() || message == null || message.isBlank()) return;
    try {
      SmsManager manager = SmsManager.getDefault();
      ArrayList<String> parts = manager.divideMessage(message);
      manager.sendMultipartTextMessage(phone, null, parts, null, null);
    } catch (RuntimeException ignored) {
      // The app's server-side queue remains the source of truth for retry/status handling.
    }
  }
}
