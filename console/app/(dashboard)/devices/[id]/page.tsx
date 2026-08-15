import { notFound } from "next/navigation";
import { isDeviceOnline, requireOwnedDevice } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { DeviceWorkspace } from "@/components/DeviceWorkspace";

export const dynamic = "force-dynamic";

export default async function DevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const { id } = await params;

  // requireOwnedDevice throws an HttpError carrying a 404 Response, which is
  // the right status but the wrong mechanism for a page; translate it.
  let device;
  try {
    device = await requireOwnedDevice(id, session.user.id);
  } catch {
    notFound();
  }

  return (
    <DeviceWorkspace
      initial={{
        id: device.id,
        name: device.name,
        hostname: device.hostname,
        osVersion: device.osVersion,
        agentVersion: device.agentVersion,
        online: isDeviceOnline(device.lastSeenAt),
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        pairedAt: device.pairedAt.toISOString(),
      }}
    />
  );
}
