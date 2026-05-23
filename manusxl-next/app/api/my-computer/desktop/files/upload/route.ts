import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { safeRecordAuditLog } from "@/server/audit/audit-store";
import { saveAndAnalyzeUploadBuffer } from "@/server/files/readers";
import { resolveMyComputerDesktopDeviceToken } from "@/server/my-computer/my-computer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function parseExpiresAt(days: unknown) {
  const numericDays = typeof days === "number" && Number.isFinite(days) ? days : 7;
  const clampedDays = Math.min(Math.max(numericDays, 1), 30);
  return new Date(Date.now() + clampedDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: string;
      name?: string;
      mimeType?: string;
      contentBase64?: string;
      sourcePath?: string;
      expiresInDays?: number;
    };
    const device = resolveMyComputerDesktopDeviceToken(bearerToken(request) ?? body.token);
    if (!device) {
      return NextResponse.json({ error: "桌面端未配对或令牌已失效。" }, { status: 401 });
    }
    const name = body.name?.trim();
    const contentBase64 = body.contentBase64?.trim();
    if (!name || !contentBase64) {
      return NextResponse.json({ error: "name and contentBase64 are required" }, { status: 400 });
    }

    const buffer = Buffer.from(contentBase64, "base64");
    const expiresAt = parseExpiresAt(body.expiresInDays);
    const file = await saveAndAnalyzeUploadBuffer({
      name,
      mimeType: body.mimeType,
      buffer,
      ownerId: device.ownerId,
      metadata: {
        source: "desktop-sync",
        uploadedByDeviceId: device.id,
        uploadedByDeviceName: device.name,
        sourcePath: body.sourcePath?.slice(0, 500) ?? "",
        expiresAt
      }
    });

    safeRecordAuditLog({
      userId: device.ownerId,
      action: "my_computer.desktop_file.upload",
      resource: `upload:${file.id}`,
      status: "completed",
      metadata: {
        deviceId: device.id,
        deviceName: device.name,
        fileName: file.name,
        fileSize: file.size,
        expiresAt
      }
    });

    return NextResponse.json({ ok: true, file, expiresAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "桌面端文件上传失败" },
      { status: 400 }
    );
  }
}
