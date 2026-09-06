"use client";

import { useState } from "react";
import InventoryWorkstation from "@/components/InventoryWorkstation";
import SupplyWorkstation from "@/components/SupplyWorkstation";

type Tab = "stock" | "supply";

export default function StockCenter({ permissions }: { permissions: string[] }) {
  const [tab, setTab] = useState<Tab>("stock");
  return <>
    <nav className="workspaceTabs" aria-label="Stock and supply sections">
      <button className={tab === "stock" ? "active" : ""} onClick={() => setTab("stock")}>Stock</button>
      <button className={tab === "supply" ? "active" : ""} onClick={() => setTab("supply")}>Ordering & counts</button>
    </nav>
    <div className="embeddedWorkspace">
      {tab === "stock" ? <InventoryWorkstation /> : <SupplyWorkstation permissions={permissions} />}
    </div>
  </>;
}
