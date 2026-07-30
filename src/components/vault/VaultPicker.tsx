"use client";

import { useEffect, useSyncExternalStore } from "react";
import { FolderOpen, Sparkles, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useVaultStore } from "@/store/vault-store";
import { isFsAccessSupported } from "@/lib/vault/fs";

// useSyncExternalStore with a server snapshot of null avoids both the
// "setState in effect" lint rule and any SSR/CSR hydration mismatch.
const emptySubscribe = () => () => {};
const supportedSnapshot = () => (typeof window === "undefined" ? null : isFsAccessSupported());
const serverSnapshot = () => null as boolean | null;

/**
 * First-run screen. Lets the user pick a real local folder via the File
 * System Access API, or fall back to an in-memory demo vault when the API
 * is unavailable (Safari/Firefox/sandboxed iframes).
 */
export function VaultPicker() {
  const openPicker = useVaultStore((s) => s.openPicker);
  const openDemoVault = useVaultStore((s) => s.openDemoVault);
  const tryRestore = useVaultStore((s) => s.tryRestorePersistedVault);
  const errorMsg = useVaultStore((s) => s.errorMsg);
  const watcherStatus = useVaultStore((s) => s.watcherStatus);
  const hasHandle = useVaultStore((s) => s.handle !== null);

  const supported = useSyncExternalStore(emptySubscribe, supportedSnapshot, serverSnapshot);

  useEffect(() => {
    // Silently attempt to re-open a previously-granted vault handle on mount.
    void tryRestore();
  }, [tryRestore]);

  // Restoring = a persisted-vault scan is in progress but no handle has landed yet.
  const restoring = !hasHandle && watcherStatus === "scanning";
  const busy = restoring;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="w-8 h-8" />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Open a Vault
            </h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              A vault is just a folder of plain-text Markdown files on your
              computer. Nothing is uploaded — your notes stay yours.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="border-border/60">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-5 h-5 text-primary" />
                  <h2 className="font-medium">Open local folder</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Pick any folder on your disk. Files are read and written
                  directly via the File System Access API.
                </p>
                {supported === false && (
                  <Badge variant="outline" className="text-amber-600 border-amber-500/40">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Not supported in this browser
                  </Badge>
                )}
                <Button
                  className="w-full"
                  onClick={() => void openPicker()}
                  disabled={busy || supported === false}
                >
                  {busy ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {restoring ? "Restoring…" : "Scanning…"}
                    </>
                  ) : (
                    <>
                      <FolderOpen className="w-4 h-4 mr-2" />
                      Choose folder
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <h2 className="font-medium">Try the demo vault</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Explore the interface with a seeded in-memory vault. Edits
                  are not persisted — perfect for a quick tour.
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={openDemoVault}
                  disabled={busy}
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Launch demo
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium">Local-first by design</p>
                <p className="text-muted-foreground">
                  There is no proprietary database. The vault <em>is</em> the
                  folder of <code className="text-xs">.md</code> files. The app
                  only keeps a derived in-memory index that can be wiped and
                  rebuilt at any time.
                </p>
              </div>
            </CardContent>
          </Card>

          {errorMsg && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-3">
              {errorMsg}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
