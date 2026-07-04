"use client";

import { useSession } from "@/lib/store";
import { ConnectionScreen } from "@/components/connection-screen";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  const sessionId = useSession((s) => s.sessionId);
  return sessionId ? <AppShell /> : <ConnectionScreen />;
}
