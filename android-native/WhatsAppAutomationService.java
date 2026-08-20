package com.therapycare.app;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import android.text.TextUtils;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Taps the Send button inside the normal WhatsApp app after Therapy Care opens a chat,
 * and reports back whether the send action was actually executed.
 * Free workflow only — no paid WhatsApp API is used.
 */
public class WhatsAppAutomationService extends AccessibilityService {
  private static final AtomicLong TOKEN = new AtomicLong(0);
  private static volatile long activeToken = 0;
  private static volatile CountDownLatch latch;
  private static volatile boolean confirmed = false;

  /** Called by the plugin just before the WhatsApp chat intent is fired. */
  public static synchronized long beginSend(String phone) {
    long token = TOKEN.incrementAndGet();
    activeToken = token;
    confirmed = false;
    latch = new CountDownLatch(1);
    return token;
  }

  public static boolean awaitConfirmation(long token, long timeoutMs) throws InterruptedException {
    CountDownLatch current = latch;
    if (current == null || token != activeToken) return false;
    boolean signalled = current.await(timeoutMs, TimeUnit.MILLISECONDS);
    return signalled && confirmed;
  }

  public static boolean isEnabled(Context context) {
    String enabled = Settings.Secure.getString(
      context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
    if (TextUtils.isEmpty(enabled)) return false;
    ComponentName component = new ComponentName(context, WhatsAppAutomationService.class);
    return enabled.contains(component.flattenToString())
      || enabled.contains(component.flattenToShortString());
  }

  @Override
  public void onAccessibilityEvent(AccessibilityEvent event) {
    if (latch == null || latch.getCount() == 0) return;
    CharSequence pkg = event.getPackageName();
    if (pkg == null) return;
    String name = pkg.toString();
    if (!name.equals("com.whatsapp") && !name.equals("com.whatsapp.w4b")) return;

    AccessibilityNodeInfo root = getRootInActiveWindow();
    if (root == null) return;
    try {
      List<AccessibilityNodeInfo> sendButtons = root.findAccessibilityNodeInfosByViewId(name + ":id/send");
      if (sendButtons == null || sendButtons.isEmpty()) return;
      for (AccessibilityNodeInfo node : sendButtons) {
        if (node != null && node.isVisibleToUser() && node.isEnabled()) {
          boolean clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
          if (clicked) {
            confirmed = true;
            CountDownLatch current = latch;
            if (current != null) current.countDown();
          }
          return;
        }
      }
    } finally {
      root.recycle();
    }
  }

  @Override
  public void onInterrupt() {
    CountDownLatch current = latch;
    if (current != null && current.getCount() > 0) {
      confirmed = false;
      current.countDown();
    }
  }
}
