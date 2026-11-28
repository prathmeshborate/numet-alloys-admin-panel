import { NextResponse } from "next/server";
import { adminAuth, adminDb, adminMessaging } from "@/lib/firebaseAdmin";

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.split("Bearer ")[1] : null;

    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await adminAuth().verifyIdToken(idToken);

    const { title, body } = await request.json();
    const baseMessage = {
      notification: {
        title: title || "Numet Alloys — Ready Stock Updated",
        body: body || "Latest stock availability has been updated. Tap to view.",
      },
      data: {
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        screen: "ready_stock",
      },
      android: {
        priority: "high",
        notification: {
          channelId: "high_importance_channel",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "86400",
        },
        notification: {
          title: title || "Numet Alloys — Ready Stock Updated",
          body: body || "Latest stock availability has been updated. Tap to view.",
          icon: "/icons/Icon-192.png",
        },
      },
    };

    // 1. Broadcast to any Android devices subscribed to 'stock_updates' topic
    const topicResult = await adminMessaging().send({
      ...baseMessage,
      topic: "stock_updates",
    });

    // 2. Fetch all registered tokens from 'fcm_tokens' (used by the Flutter app)
    const tokensSnap = await adminDb().collection("fcm_tokens").get();
    const tokenEntries = tokensSnap.docs
      .map((doc) => ({
        docId: doc.id,
        token: doc.data()?.token || doc.id,
      }))
      .filter((entry) => Boolean(entry.token));

    let deviceSuccessCount = 0;
    let deviceFailureCount = 0;

    if (tokenEntries.length > 0) {
      const multicastResult = await adminMessaging().sendEachForMulticast({
        ...baseMessage,
        tokens: tokenEntries.map((e) => e.token),
      });

      deviceSuccessCount = multicastResult.successCount;
      deviceFailureCount = multicastResult.failureCount;

      // Remove invalid or expired tokens automatically
      const cleanup = [];
      multicastResult.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code || "";
          if (
            errCode === "messaging/registration-token-not-registered" ||
            errCode === "messaging/invalid-registration-token"
          ) {
            cleanup.push(adminDb().collection("fcm_tokens").doc(tokenEntries[idx].docId).delete());
          }
        }
      });
      await Promise.all(cleanup);
    }

    return NextResponse.json({
      success: true,
      topicMessageId: topicResult,
      totalTokensFound: tokenEntries.length,
      devicesNotified: deviceSuccessCount,
      devicesFailed: deviceFailureCount,
    });
  } catch (error) {
    console.error("Notify error:", error);
    return NextResponse.json({ error: error.message || "Server error" }, { status: 500 });
  }
}