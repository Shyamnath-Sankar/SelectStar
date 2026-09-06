"use client";

/**
 * Client-only Toaster wrapper.
 *
 * Sonner's internal toast store uses a Set, which can't be serialized by the
 * React Server Component protocol. Rendering the Toaster from a Server
 * Component (like app/layout.tsx) triggers a noisy warning on every render:
 *
 *   "Only plain objects can be passed to Client Components from Server
 *    Components. Set objects are not supported."
 *
 * This wrapper is a Client Component (marked "use client" above) and uses
 * next/dynamic with ssr:false to skip server rendering of the Toaster
 * entirely, so the Set never crosses the RSC boundary.
 *
 * Imported from app/layout.tsx:
 *   import { ClientToaster } from "@/components/client-toaster";
 *   ...
 *   <ClientToaster />
 */
import dynamic from "next/dynamic";

const Toaster = dynamic(
  () => import("@/components/ui/sonner").then((m) => m.Toaster),
  { ssr: false }
);

export function ClientToaster() {
  return <Toaster richColors closeButton position="top-center" />;
}
