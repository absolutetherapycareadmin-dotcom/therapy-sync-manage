package com.therapycare.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.telephony.SmsManager;
import java.util.ArrayList;

public class SmsAlarmReceiver extends BroadcastReceiver {
  public static final String ACTION_SEND_SMS = "com.therapycare.app.SEND_SMS";
  public static final String EXTRA_PHONE = "phone";
  public static final String EXTRA_MESSAGE = "message";

  @Override public void onReceive(Context context, Intent intent) {
    if (ACTION_SEND_SMS.equals(intent.getAction())) {
      sendScheduledSms(context, intent);
      return;
    }

    if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
      captureInboundSms(context, intent);
    }
  }

  private void sendScheduledSms(Context context, Intent intent) {
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

  private void captureInboundSms(Context context, Intent intent) {
    Bundle extras = intent.getExtras();
    if (extras == null) return;
    SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
    if (messages == null || messages.length == 0) return;

    StringBuilder body = new StringBuilder();
    String sender = null;
    long receivedAt = System.currentTimeMillis();
    for (SmsMessage message : messages) {
      if (sender == null) sender = message.getOriginatingAddress();
      body.append(message.getMessageBody());
      if (message.getTimestampMillis() > 0) receivedAt = message.getTimestampMillis();
    }

    SmsBridge.storeInboundSms(context, sender, body.toString(), receivedAt);
  }
}
