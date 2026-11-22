import { NextResponse } from "next/server";
import { adminAuth, adminDb, adminMessaging } from "@/lib/firebaseAdmin";

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.split("Bearer ")[1] : null;

    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await adminAuth.verifyIdToken(idToken);

    const { title, body } = await request.json();
    const notificationPayload = {
      title: title || "Numet Alloys — Ready Stock Updated",
      body: body || "Latest stock availability has been updated. Tap to view.",
    };

    // 1. Broadcast to Android APK users subscribed to 'stock_updates'
    const topicResult = await adminMessaging.send({
      topic: "stock_updates",
      notification: notificationPayload,
    });

    // 2. Broadcast to iOS/Web PWA tokens saved in Firestore
    const tokensSnap = await adminDb.collection("push_tokens").get();
    const webTokens = tokensSnap.docs.map((doc) => doc.id).filter(Boolean);

    let webSuccessCount = 0;
    if (webTokens.length > 0) {
      const multicastResult = await adminMessaging.sendEachForMulticast({
        tokens: webTokens,
        notification: notificationPayload,
      });
      webSuccessCount = multicastResult.successCount;

      // Remove invalid/expired tokens automatically
      const cleanup = [];
      multicastResult.responses.forEach((resp, idx) => {
        if (!resp.success) {
          cleanup.push(adminDb.collection("push_tokens").doc(webTokens[idx]).delete());
        }
      });
      await Promise.all(cleanup);
    }

    return NextResponse.json({
      success: true,
      topicMessageId: topicResult,
      webNotified: webSuccessCount,
    });
  } catch (error) {
    console.error("Notify error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}