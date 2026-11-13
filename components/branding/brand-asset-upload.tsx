"use client";

import { useState, useTransition } from "react";
import { uploadBrandingAssetAction } from "@/lib/actions/branding";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";

export function BrandAssetUpload({ kind }: { kind: "logo" | "install_icon" }) {
  const icon = kind === "install_icon";
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  function upload() {
    if (!file || pending) return;
    setMessage(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      try {
        const result = await uploadBrandingAssetAction(form);
        setFailed(!result.ok);
        setMessage(result.ok ? "Saved." : "The upload was not saved. Check the file or try again later.");
        if (!result.ok) return;
      } catch {
        setFailed(true);
        setMessage("We could not confirm the upload. Check the current image before you retry.");
      }
      // Refresh is best effort; it cannot change a confirmed mutation result.
      try { router.refresh(); } catch { /* Keep the truthful result visible. */ }
    });
  }
  return <div className="border-t border-line pt-4">
    <label className="block text-[13px] font-medium">
      {icon ? "Install icon" : "Club logo"}
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={pending} onChange={(event) => { if (!pending) { setFile(event.target.files?.[0] ?? null); setMessage(null); } }} className="mt-2 block w-full text-sm" />
    </label>
    <p className="mt-1 text-[12px] text-ink-3">PNG, JPEG or WebP, up to 750 KB. {icon ? "Installed icons may take time to update and may require reinstalling." : "Images are converted to PNG."}</p>
    <Button type="button" variant="secondary" className="mt-2" disabled={!file || pending} onClick={upload}>{pending ? "Uploading…" : icon ? "Upload install icon" : "Upload logo"}</Button>
    {message ? <p className="mt-2 text-[13px] text-ink-2" role={failed ? "alert" : "status"}>{message}</p> : null}
  </div>;
}
