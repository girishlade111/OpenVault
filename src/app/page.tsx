"use client";

import { useSyncExternalStore } from "react";
import { useVaultStore } from "@/store/vault-store";
import { VaultPicker } from "@/components/vault/VaultPicker";
import { VaultApp } from "@/components/vault/VaultApp";

// Mount-gate via useSyncExternalStore: server snapshot is false (picker),
// client snapshot becomes true after hydration. Avoids both SSR mismatch and
// the "setState in effect" lint rule.
const emptySubscribe = () => () => {};
const mountedClient = () => true;
const mountedServer = () => false;

export default function Home() {
  const handle = useVaultStore((s) => s.handle);
  const mounted = useSyncExternalStore(emptySubscribe, mountedClient, mountedServer);

  if (!mounted) {
    return <div className="h-screen bg-background" />;
  }

  if (!handle) {
    return <VaultPicker />;
  }

  return <VaultApp />;
}
