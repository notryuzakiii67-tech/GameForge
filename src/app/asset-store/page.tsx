import type { Metadata } from "next";
import { AssetStore } from "@/components/AssetStore";

export const metadata: Metadata = { title: "Community Asset Store" };

export default function AssetStorePage() {
  return <AssetStore />;
}
