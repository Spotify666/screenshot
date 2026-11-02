import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Viewer } from "@/components/viewer";
import { getScreenshotBySlug } from "@/lib/server/data";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// Deliberately generic: link previews (WhatsApp, iMessage…) never show the
// screenshot itself, so nothing lingers in a chat after it's deleted.
export const metadata: Metadata = {
  title: "Shared screenshot",
  description: "A screenshot shared with you on Longshot.",
  openGraph: { title: "Shared screenshot", description: "Open to view it at full resolution." },
};

export default async function SharedScreenshotPage({ params }: Props) {
  const { slug } = await params;
  const screenshot = await getScreenshotBySlug(slug);
  if (!screenshot) notFound();
  return <Viewer key={screenshot.id} screenshot={screenshot} mode="shared" />;
}
